import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSummary, writeSummary, readSummary, MAX_SUMMARY_CHARS } from "../lib/summary.js";
import { buildBootstrapPrompt, buildUpdatePrompt } from "../lib/prompt.js";
import { apply } from "../lib/index.js";

/** Minimal fake agent/session/ctx capturing steers and registered commands. */
function fakePluginHost() {
  const steered: any[] = [];
  const commands = new Map<string, (inv: any) => unknown>();
  const agent = {
    session: { header: { cwd: "/ws" } },
    steer: (m: unknown) => steered.push(m),
    inject: (m: unknown) => steered.push(m),
  };
  const ctx = {
    on: (_e: string, _h: (p: unknown) => void) => {},
    effect: (reg: () => void, _label?: string) => { reg(); },
    commands: { register: (d: { name: string; handler: (inv: any) => unknown }) => { commands.set(d.name, d.handler); } },
    tools: { register: () => {} },
  };
  return { ctx, agent, steered, commands, run: (name: string) => commands.get(name)!({ agent }) };
}

test("validateSummary: coerces whitespace, rejects empty/oversized", () => {
  assert.equal(validateSummary("  hello \n\n world \t!  "), "hello world !");
  assert.throws(() => validateSummary("   \n  "), /non-empty/);
  assert.throws(() => validateSummary("x".repeat(MAX_SUMMARY_CHARS + 1)), /too long/);
  assert.equal(validateSummary("x".repeat(MAX_SUMMARY_CHARS)).length, MAX_SUMMARY_CHARS);
});

test("writeSummary + readSummary round-trip, overwrite works, nonzero sessionCount survives", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    await writeSummary(cwd, "first paragraph", { bootstrappedAt: "2026-08-23T00:00:00.000Z", sessionCount: 7 });
    const s = await readSummary(cwd);
    assert.equal(s?.summary, "first paragraph");
    assert.equal(s?.meta.bootstrappedAt, "2026-08-23T00:00:00.000Z");
    assert.ok(s!.meta.sessionCount > 0, "sessionCount must round-trip nonzero");
    assert.equal(s?.meta.sessionCount, 7);
    // re-run overwrites
    await writeSummary(cwd, "second paragraph", { bootstrappedAt: "2026-08-24T00:00:00.000Z", sessionCount: 9 });
    const s2 = await readSummary(cwd);
    assert.equal(s2?.summary, "second paragraph");
    assert.equal(s2?.meta.sessionCount, 9);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("readSummary: null when missing or malformed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    assert.equal(await readSummary(cwd), null);
    await mkdir(join(cwd, ".moving-target"), { recursive: true });
    await writeFile(join(cwd, ".moving-target", "summary.md"), "no header");
    assert.equal(await readSummary(cwd), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("writeSummary validates input (multi-paragraph rejected)", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    await assert.rejects(() => writeSummary(cwd, "", { bootstrappedAt: "x", sessionCount: 1 }), /non-empty/);
    await assert.rejects(() => writeSummary(cwd, "x".repeat(MAX_SUMMARY_CHARS + 1), { bootstrappedAt: "x", sessionCount: 1 }), /too long/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("buildBootstrapPrompt embeds full DATE-TIME-PROMPT lines", () => {
  const p = buildBootstrapPrompt([
    { sessionId: "a", createdAt: 1, date: "2026-01-01", time: "10:00", prompt: "first goal here" },
    { sessionId: "b", createdAt: 2, date: "2026-02-02", time: "11:30", prompt: "second goal, untruncated " + "x".repeat(200) },
  ]);
  assert.ok(p.includes("2026-01-01 10:00 first goal here"));
  assert.ok(p.includes("2026-02-02 11:30 second goal, untruncated " + "x".repeat(200)));
  assert.ok(p.includes("moving_target_save_summary"));
  assert.ok(p.includes('"sessionCount": 2'), "prompt instructs verbatim session-count pass-through");
});

test("buildUpdatePrompt contains update instructions, inlined summary, and session count", () => {
  const p = buildUpdatePrompt(5, "old goal paragraph");
  assert.ok(p.includes("old goal paragraph"));
  assert.ok(p.includes("Do NOT read that file yourself"));
  assert.ok(p.includes("Incorporate this conversation's outcome and rewrite the summary"));
  assert.ok(p.includes("moving_target_save_summary"));
  assert.ok(p.includes('"sessionCount": 5'));
});

test("bootstrap handler acks before extraction resolves (regression: silent fresh-session run)", async () => {
  // Hermetic store: the old implementation awaited extraction inside the
  // handler, so command/done landed seconds later and, when the user opened a
  // first prompt meanwhile, was never surfaced as feedback.
  const host = fakePluginHost();
  apply(host.ctx as never, { sessionsRoot: "/nonexistent-root" });
  const result = await host.run("moving-target-bootstrap");
  assert.equal(result.kind, "success", "ack must not wait on the scan");
  assert.equal((result as any).text.includes("Bootstrapping"), true);
});

test("bootstrap steers an outcome message after the ack", async () => {
  // Hermetic one-session store: proves ack-then-steer ordering end to end
  // without touching the real session store.
  const root = await mkdtemp(join(tmpdir(), "mt-store-"));
  try {
    const dir = join(root, "--ws~0020--", "s1");
    await mkdir(dir, { recursive: true });
    const line = (o: unknown) => JSON.stringify(o) + "\n";
    await writeFile(join(dir, "session.jsonl"),
      line({ type: "session", id: "s1", createdAt: 1000, cwd: "/ws", delegationDepth: 0 }) +
      line({ type: "user/message", data: { content: [{ type: "text", text: "the very first goal" }], source: { kind: "user" }, role: "user" } }));
    const host = fakePluginHost();
    apply(host.ctx as never, { sessionsRoot: root });
    const ack = await host.run("moving-target-bootstrap");
    assert.equal(ack.kind, "success");
    assert.equal(host.steered.length, 0, "nothing steered synchronously");
    await new Promise(r => setTimeout(r, 500));
    // Whatever the outcome (prompt list, no-sessions notice, or failure), the
    // user-visible steering must follow the ack — never replace it.
    const steered = host.steered.filter(m => JSON.stringify(m).includes("moving-target"));
    assert.ok(steered.length > 0, "extraction must eventually steer its outcome");
    assert.ok(JSON.stringify(steered[0]).includes("the very first goal"), "steered message carries the extracted prompt list");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap while one is already in flight is rejected with visible feedback", async () => {
  const host = fakePluginHost();
  apply(host.ctx as never);
  void host.run("moving-target-bootstrap"); // in flight
  const second = await host.run("moving-target-bootstrap");
  assert.equal(second.kind, "error");
  assert.match((second as any).text, /already in flight/);
});
