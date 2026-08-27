/**
 * moving-target: deterministic first-prompt extraction from DSH session logs.
 *
 * Scans a DSH sessions root (default ~/.dsh/sessions), keeps top-level
 * sessions whose header cwd matches exactly, and returns the first human
 * user prompt of each, oldest first. No LLM involved.
 */
import { spawn } from "node:child_process";
import { access, open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionFirstPrompt {
  sessionId: string;
  createdAt: number; // epoch ms
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  prompt: string;
}

const DEFAULT_HEAD_BYTES = 1 << 20; // generous 1 MiB window covers header + first prompts

/**
 * Replicate the DSH session store's project-directory key for a cwd
 * (dsh-session-persistence-jsonl `projectKey`): separators collapse to `-`,
 * unsafe code units escape as `~XXXX`, wrapped in `--…--`. Lets extraction
 * scan one workspace's directory instead of every project in the store.
 * Verified byte-identical against the on-disk layout.
 */
export function projectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/** Decompress the head of a zstd file via `zstd -dc`, cutting at the first
 * newline at or after `bytes` — so truncation never loses a whole line.
 * `spawnFn` is injectable for tests (fake chunked stdout). */
export function zstdHead(
  path: string,
  bytes: number,
  spawnFn: (cmd: string, args: string[]) => any = (c, a) => spawn(c, a),
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn("zstd", ["-dc", path]);
    let out = Buffer.alloc(0);
    let done = false;
    const finish = (data: string) => { if (!done) { done = true; proc.kill(); resolve(data); } };
    proc.stdout.on("data", (chunk: Buffer) => {
      out = Buffer.concat([out, chunk]);
      const nl = out.indexOf(0x0a, bytes); // newline past the budget keeps the straddling line intact
      if (out.length >= bytes && nl >= 0) finish(out.subarray(0, nl + 1).toString("utf8"));
    });
    proc.on("error", reject); // e.g. ENOENT when zstd is not installed — surfaced to caller
    proc.on("close", () => finish(out.toString("utf8")));
  });
}

/**
 * Read the head lines of a session log (plain .jsonl or .jsonl.zstd).
 * Plain files stream from a file handle — never a full read.
 */
async function headLines(path: string, lines: number, bytes: number): Promise<string[]> {
  const text = path.endsWith(".zstd")
    ? await zstdHead(path, bytes)
    : await open(path, "r").then(async fh => {
        const buf = Buffer.alloc(bytes);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        return buf.subarray(0, bytesRead).toString("utf8");
      });
  return text.split("\n").filter(Boolean).slice(0, lines);
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Scan one session directory for this workspace's first human prompt. */
async function scanSession(dir: string, cwd: string, headBytes: number): Promise<SessionFirstPrompt | null> {
  let log: string | undefined;
  for (const name of ["session.jsonl.zstd", "session.jsonl"]) {
    try { await access(join(dir, name)); log = join(dir, name); break; } catch {}
  }
  if (!log) return null;
  let lines: string[];
  try { lines = await headLines(log, 200, headBytes); }
  catch (e) {
    // Missing zstd binary would silently drop every compressed session — fail loud instead.
    if (log.endsWith(".zstd") && e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`zstd not found on PATH — cannot read compressed session log ${log}: ${e.message}`);
    }
    return null;
  }
  let header: any;
  try { header = JSON.parse(lines[0] ?? "{}"); } catch { return null; } // corrupt log: skip session
  if (header.type !== "session") return null;
  if (header.cwd !== cwd) return null; // exact string equality (trailing spaces matter)
  if ((header.delegationDepth ?? 0) !== 0) return null;
  if (header.origin === "subagent" || header.parentSession !== undefined) return null;
  const first = lines.slice(1).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .find(r => r?.type === "user/message" && r.data?.source?.kind === "user");
  if (!first) return null; // empty session: no human prompt
  const text = (first.data.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text).join("");
  if (!text) return null;
  // date/time intentionally use the runner-local timezone of createdAt
  // (header's clientTimeZone is ignored for determinism on this machine).
  const d = new Date(header.createdAt);
  return {
    sessionId: header.id,
    createdAt: header.createdAt,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    prompt: text,
  };
}

export async function extractFirstPrompts(
  cwd: string,
  sessionsRoot: string = join(homedir(), ".dsh", "sessions"),
  opts: { headBytes?: number } = {},
): Promise<SessionFirstPrompt[]> {
  const headBytes = opts.headBytes ?? DEFAULT_HEAD_BYTES;
  const collect = async (projectDir: string): Promise<SessionFirstPrompt[]> => {
    const out: SessionFirstPrompt[] = [];
    for (const sessionDir of await readdir(projectDir, { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) continue;
      const record = await scanSession(join(projectDir, sessionDir.name), cwd, headBytes);
      if (record) out.push(record);
    }
    return out;
  };
  let results: SessionFirstPrompt[];
  try {
    // Fast path: the store groups sessions under one directory per project —
    // scan only this workspace's group. Header cwd is still verified per log.
    results = await collect(join(sessionsRoot, projectKey(cwd)));
  } catch {
    // Unknown layout (custom root, older DSH): fall back to scanning every
    // project and filtering by header cwd.
    results = [];
    for (const projectDir of await readdir(sessionsRoot, { withFileTypes: true })) {
      if (!projectDir.isDirectory()) continue;
      try { results.push(...await collect(join(sessionsRoot, projectDir.name))); }
      catch { continue; }
    }
  }
  return results.sort((a, b) => a.createdAt - b.createdAt);
}
