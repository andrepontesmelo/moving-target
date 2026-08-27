/** Bootstrap prompt builder — pure, no DSH imports. */
import type { SessionFirstPrompt } from "./extract.js";
import { MAX_SUMMARY_CHARS } from "./summary.js";

/** Build the bootstrap prompt: DATE-TIME-PROMPT list + instructions. */
export function buildBootstrapPrompt(records: SessionFirstPrompt[]): string {
  const list = records.map(r => `${r.date} ${r.time} ${r.prompt}`).join("\n");
  return `You are bootstrapping the "moving target" plugin for this workspace.

Below is the first user prompt of every past session in this workspace (oldest first), extracted deterministically from the session store — no LLM was involved:

${list}

Based on these prompts, summarize the end goal of this project in ONE paragraph.
Then call the moving_target_save_summary tool with:
- "summary": that paragraph (a single paragraph, plain text, max ${MAX_SUMMARY_CHARS} characters)
- "sessionCount": ${records.length} (the number of sessions listed above — pass it through verbatim)
The summary will be saved to .moving-target/summary.md and injected into future sessions.`;
}

/** Build the update prompt: rewrite instructions with the current summary inlined (never re-read from disk) and session count. */
export function buildUpdatePrompt(sessionCount: number, currentSummary: string): string {
  return `You are updating the "moving target" project goal summary for this workspace.

Below is the CURRENT summary, read deterministically from .moving-target/summary.md. Do NOT read that file yourself:

${currentSummary}

Incorporate this conversation's outcome and rewrite the summary so that:
1. It remains ONE paragraph, plain text, max ${MAX_SUMMARY_CHARS} characters.
2. It keeps the same high level as the current summary.
3. It includes no specific reference to this chat and no decision history.

Then call the moving_target_save_summary tool with:
- "summary": the rewritten paragraph
- "sessionCount": ${sessionCount} (pass it through verbatim — do not change it)`;
}
