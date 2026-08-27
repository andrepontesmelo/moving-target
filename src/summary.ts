/** Pure summary persistence helpers — no DSH imports, unit-testable standalone. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SummaryMeta {
  bootstrappedAt: string; // ISO
  sessionCount: number;
}

export interface StoredSummary {
  summary: string;
  meta: SummaryMeta;
}

export const SUMMARY_DIR = ".moving-target";
export const SUMMARY_FILE = "summary.md";
export const MAX_SUMMARY_CHARS = 2000;

/** Validate + normalize the model-supplied summary. Throws on rule violation. */
export function validateSummary(raw: string): string {
  if (typeof raw !== "string") throw new Error("summary must be a string");
  const s = raw.replace(/\s+/g, " ").trim(); // coerce whitespace to single spaces
  if (!s) throw new Error("summary must be non-empty");
  if (s.length > MAX_SUMMARY_CHARS) {
    throw new Error(`summary too long: ${s.length} chars (max ${MAX_SUMMARY_CHARS}) — condense it, don't just truncate`);
  }
  return s;
}

/** Write .moving-target/summary.md — metadata header lines, blank line, paragraph.
 * Validates the summary first so every caller keeps the readSummary round-trip intact. Overwrites. */
export async function writeSummary(cwd: string, summary: string, meta: SummaryMeta): Promise<string> {
  summary = validateSummary(summary);
  const text = `<!-- moving-target -->
bootstrappedAt: ${meta.bootstrappedAt}
sessionCount: ${meta.sessionCount}

${summary}
`;
  const path = join(cwd, SUMMARY_DIR, SUMMARY_FILE);
  await mkdir(join(cwd, SUMMARY_DIR), { recursive: true });
  await writeFile(path, text, "utf8");
  return path;
}

/** Parse .moving-target/summary.md back into { summary, meta }. */
export async function readSummary(cwd: string): Promise<StoredSummary | null> {
  let text: string;
  try { text = await readFile(join(cwd, SUMMARY_DIR, SUMMARY_FILE), "utf8"); }
  catch { return null; } // not bootstrapped
  if (!text.startsWith("<!-- moving-target -->\n")) return null;
  const body = text.slice("<!-- moving-target -->\n".length);
  const blank = body.indexOf("\n\n");
  if (blank < 0) return null;
  const meta: Record<string, string> = {};
  for (const line of body.slice(0, blank).split("\n")) {
    const m = /^(\w+): (.*)$/.exec(line);
    if (m) meta[m[1]] = m[2];
  }
  return {
    summary: body.slice(blank + 2).trim(),
    meta: {
      bootstrappedAt: meta.bootstrappedAt ?? "",
      sessionCount: Number(meta.sessionCount ?? 0) || 0,
    },
  };
}
