/**
 * moving-target DSH plugin — bootstrap/update commands + summary capture tool.
 *
 * /moving-target-bootstrap feeds the agent the deterministic DATE-TIME-PROMPT
 * list of every past top-level session in the workspace (from src/extract.ts,
 * no LLM), asks for a one-paragraph project goal summary, and captures it via
 * the moving_target_save_summary tool into .moving-target/summary.md.
 * Re-runnable; overwrites.
 *
 * /moving-target-update injects the current summary content (read deterministically
 * by the handler) into the steered prompt and instructs the agent to rewrite it
 * based on the current session outcome without re-reading the file.
 *
 * NOTE: DSH peer packages resolve only after install into a DSH profile;
 * ctx/agent objects are defensively typed (any) until then.
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { extractFirstPrompts } from "./extract.js";
import {
  MAX_SUMMARY_CHARS, readSummary, writeSummary,
} from "./summary.js";
import { buildBootstrapPrompt, buildUpdatePrompt } from "./prompt.js";
import { injectionText, type StartSource } from "./inject.js";

export const name = "moving-target";
export const inject = ["commands", "tools"];

export function apply(ctx: any, config: { sessionsRoot?: string } = {}): void {
  const sessionsRoot = config.sessionsRoot;
  // Per-workspace bootstrap runs whose extraction has not finished yet
  // (scoped to this plugin instance, so parallel mounts stay independent).
  const bootstrapsInFlight = new Set<string>();
  // Cold-start injection: seed a NEW session (source 'startup' only — resume
  // and compact already carry context) with the bootstrapped summary, without
  // waking the driver. No-op when not bootstrapped or for subagents.
  ctx.on("agent/session-start", ({ agent, source }: { agent: any; source: StartSource }) => {
    const header = agent?.session?.header;
    // Cheap guards only — must NOT validate the stored summary (not read yet).
    if (!header?.cwd || source !== "startup") return;
    if ((header.delegationDepth ?? 0) > 0 || header.origin === "subagent") return;
    // readSummary is async: the file read happens after the event fired, so a
    // disposed/compacted agent could theoretically miss the inject window
    // (per inject() docs, pending context may be discarded) — acceptable here.
    void (async () => {
      const t = injectionText(header, await readSummary(header.cwd), source);
      if (t !== null) {
        agent.inject(createUserMessage({
          content: [{ type: "text", text: t }],
          source: { kind: "plugin", plugin: "moving-target", form: "instructions" },
        }));
      }
    })().catch(() => {}); // never let a raced read/inject reject unhandled
  });

  ctx.effect(() => ctx.commands.register({
    name: "moving-target-bootstrap",
    description: "Bootstrap the moving-target goal summary for this workspace (re-runnable, overwrites)",
    handler: ({ agent }: { agent: any }) => {
      const cwd: string | undefined = agent?.session?.header?.cwd;
      if (!cwd) return { kind: "error" as const, text: "No workspace cwd on this session" };
      // Extracting every past session can take seconds; acknowledge the
      // invocation synchronously and steer once the list is ready, so the
      // command/done feedback never races a turn the user opens meanwhile.
      if (bootstrapsInFlight.has(cwd)) {
        return { kind: "error" as const, text: "A bootstrap run is already in flight — wait for its steering message" };
      }
      bootstrapsInFlight.add(cwd);
      void extractFirstPrompts(cwd, sessionsRoot).then((records) => {
        bootstrapsInFlight.delete(cwd);
        if (records.length === 0) {
          agent.steer(createUserMessage({
            content: [{ type: "text", text: `moving-target bootstrap found no past sessions for ${cwd} — nothing to summarize.` }],
            source: { kind: "plugin", plugin: "moving-target", form: "instructions" },
          }));
          return;
        }
        agent.steer(createUserMessage({
          content: [{ type: "text", text: buildBootstrapPrompt(records) }],
          source: { kind: "plugin", plugin: "moving-target", form: "instructions" },
        }));
      }).catch((e) => {
        bootstrapsInFlight.delete(cwd);
        agent.steer(createUserMessage({
          content: [{ type: "text", text: `moving-target bootstrap failed to scan past sessions: ${e instanceof Error ? e.message : String(e)}` }],
          source: { kind: "plugin", plugin: "moving-target", form: "instructions" },
        }));
      });
      return {
        kind: "success" as const,
        text: `Bootstrapping: scanning past sessions of ${cwd}… The first-prompt list will be steered to this agent shortly; it will then save the summary via moving_target_save_summary. Re-runnable — re-running overwrites .moving-target/summary.md.`,
      };
    },
  }), "moving-target: bootstrap command");

  ctx.effect(() => ctx.commands.register({
    name: "moving-target-update",
    description: "Update the moving-target goal summary based on the current session outcome",
    handler: async ({ agent }: { agent: any }) => {
      const cwd: string | undefined = agent?.session?.header?.cwd;
      if (!cwd) return { kind: "error" as const, text: "No workspace cwd on this session" };
      const current = await readSummary(cwd);
      if (!current?.summary) { // null = missing/malformed; empty = tampered file
        return { kind: "error" as const, text: "No moving-target summary found to update. Run /moving-target-bootstrap first." };
      }
      agent.steer(createUserMessage({
        content: [{ type: "text", text: buildUpdatePrompt(current.meta.sessionCount, current.summary) }],
        source: { kind: "plugin", plugin: "moving-target", form: "instructions" },
      }));
      return {
        kind: "success" as const,
        text: `Updating summary: steering agent to rewrite .moving-target/summary.md from this conversation outcome (sessionCount ${current.meta.sessionCount} carried forward). The agent will save via moving_target_save_summary.`,
      };
    },
  }), "moving-target: update command");

  ctx.effect(() => ctx.tools.register(defineTool({
    name: "moving_target_save_summary",
    description: `Save the one-paragraph project goal summary for this workspace (bootstrapped from past sessions' first prompts). Single paragraph, max ${MAX_SUMMARY_CHARS} chars. Overwrites any previous summary.`,
    parameters: {
      summary: { type: "string", required: true, description: "One-paragraph project goal summary, plain text" },
      sessionCount: { type: "integer", required: true, description: "Number of past sessions the summary was distilled from (pass it through verbatim)" },
    },
    output: {
      schema: { type: "string" },
      render: (_args: unknown, value: unknown) => [{ type: "text", text: String(value) }],
    },
    async execute(args: { summary: string; sessionCount: number }, exec: any) {
      const cwd: string | undefined = exec?.agent?.session?.header?.cwd;
      if (!cwd) throw new Error("moving_target_save_summary requires a calling agent session with a cwd");
      const path = await writeSummary(cwd, args.summary, {
        bootstrappedAt: new Date().toISOString(),
        sessionCount: args.sessionCount,
      });
      return `Saved summary to ${path} (sessionCount: ${args.sessionCount})`;
    },
  })), "moving-target: save-summary tool");
}
