/** Pure injection decision — no DSH imports, unit-testable standalone. */
import type { StoredSummary } from "./summary.js";

/** Minimal header shape the decision needs (mirrors dsh-session SessionHeader). */
export interface HeaderLike {
  cwd?: string;
  delegationDepth?: number;
  origin?: string;
}

/** Session-start sources (mirrors dsh-agent SessionStartSource). */
export type StartSource = "startup" | "resume" | "clear" | "compact";

/**
 * Decide the injected text for a starting session.
 * Returns null (no-op) when: not a fresh startup (resume/compact already carry
 * context; "clear" is an explicit wipe), no cwd, subagent session
 * (delegationDepth > 0 or origin "subagent" — both on the persisted header),
 * not bootstrapped, or the stored file lacks a bootstrappedAt timestamp.
 */
export function injectionText(
  header: HeaderLike | undefined,
  stored: StoredSummary | null,
  source: StartSource = "startup",
): string | null {
  if (source !== "startup") return null; // seed only NEW sessions
  if (!header?.cwd) return null;
  // Subagents get delegated tasks, not workspace cold-start context — skip cheaply via header.
  if ((header.delegationDepth ?? 0) > 0) return null;
  if (header.origin === "subagent") return null;
  if (!stored?.summary || !stored.meta.bootstrappedAt) return null; // missing/empty timestamp = not bootstrapped
  return `Project goal (moving-target, bootstrapped ${stored.meta.bootstrappedAt}): ${stored.summary}`;
}
