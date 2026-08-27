import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFirstPrompts, zstdHead } from "../lib/extract.js";

const CWD = "/tmp/proj "; // note trailing space — must match exactly

function userMsg(text: string, kind = "user") {
  return JSON.stringify({
    type: "user/message",
    seq: 1,
    time: 0,
    data: { content: [{ type: "text", text }], source: { kind }, role: "user", id: "x" },
  });
}

function header(over: Record<string, unknown> = {}) {
  return JSON.stringify({ type: "session", version: 0, id: over.id ?? "s1", createdAt: 1000, cwd: CWD, delegationDepth: 0, ...over });
}

async function makeSession(root: string, sessionId: string, lines: string[], zstd = false) {
  const dir = join(root, "--tmp-proj~0020--", sessionId);
  await mkdir(dir, { recursive: true });
  const log = join(dir, zstd ? "session.jsonl.zstd" : "session.jsonl");
  if (zstd) {
    execFileSync("zstd", ["-o", log], { input: lines.join("\n") + "\n" });
  } else {
    await writeFile(log, lines.join("\n") + "\n");
  }
}

test("filters cwd, subagents, source.kind; skips empty; sorts ascending", async () => {
  const root = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    await makeSession(root, "older", [header({ id: "older", createdAt: 2000 }), userMsg("second session")]);
    await makeSession(root, "newer", [header({ id: "newer", createdAt: 1000 }), userMsg("first session")]);
    // wrong cwd
    await makeSession(root, "other", [header({ id: "other", cwd: "/elsewhere" }), userMsg("nope")]);
    // subagent via delegationDepth
    await makeSession(root, "sub1", [header({ id: "sub1", delegationDepth: 1 }), userMsg("nope")]);
    // subagent via origin
    await makeSession(root, "sub2", [header({ id: "sub2", origin: "subagent" }), userMsg("nope")]);
    // user/message but source.kind !== user
    await makeSession(root, "plugin", [header({ id: "plugin" }), userMsg("nope", "plugin")]);
    // no user message at all
    await makeSession(root, "empty", [header({ id: "empty" }), JSON.stringify({ type: "session/title", data: {} })]);
    // zstd variant of a good session
    await makeSession(root, "zst", [header({ id: "zst", createdAt: 3000 }), JSON.stringify({ type: "permission/preset", data: {} }), userMsg("zstd session")], true);

    const out = await extractFirstPrompts(CWD, root);
    assert.deepEqual(out.map(r => [r.sessionId, r.prompt]), [
      ["newer", "first session"],
      ["older", "second session"],
      ["zst", "zstd session"],
    ]);
    assert.equal(out[0].createdAt, 1000);
    const d = new Date(1000);
    const p = (n: number) => String(n).padStart(2, "0");
    assert.equal(out[0].date, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    assert.equal(out[0].time, `${p(d.getHours())}:${p(d.getMinutes())}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zstdHead keeps a line that straddles the byte budget, across small chunks", async () => {
  // fake stdout delivering 50-byte chunks; newline at 8 and 108 (both BEFORE the
  // 120-byte budget) and at ~259 (after it). Old logic searched for a newline from
  // the current chunk's start, so once past the budget it wrongly cut at 108;
  // correct logic cuts at the first newline at/after the budget (259), keeping the straddling line whole.
  const data = Buffer.from('{"a":1}\n' + "b".repeat(99) + "\n" + "x".repeat(150) + " tail\n");
  const listeners: Record<string, (c: Buffer) => void> = {};
  const promise = zstdHead("ignored.zstd", 120, () => ({
    stdout: { on: (e: string, f: (c: Buffer) => void) => { listeners[e] = f; } },
    on: () => {},
    kill: () => {},
  }) as any);
  // zstdHead wires 'data' synchronously inside the promise constructor
  for (let i = 0; i < data.length; i += 50) listeners["data"]?.(data.subarray(i, i + 50));
  assert.equal(await promise, data.toString("utf8"));
});

test("corrupt header log is skipped, good sessions survive", async () => {
  const root = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    const dir = join(root, "--tmp-proj~0020--", "corrupt");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.jsonl"), "{not json\n" + userMsg("never"));
    await makeSession(root, "good", [header({ id: "good" }), userMsg("intact")]);
    const out = await extractFirstPrompts(CWD, root);
    assert.deepEqual(out.map(r => r.sessionId), ["good"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions are found via the store's project-key grouping (fast path)", async () => {
  // The real DSH layout groups sessions under projectKey(cwd); extraction must
  // read that group directly instead of scanning every project in the store.
  const root = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    const key = "--tmp-proj~0020--";
    await makeSession(root, "grouped", [header({ id: "grouped" }), userMsg("found via group")]);
    // a session for another workspace lives in its own project dir and must not be touched
    const otherDir = join(root, "--elsewhere--", "other");
    await mkdir(otherDir, { recursive: true });
    await writeFile(join(otherDir, "session.jsonl"), header({ id: "other", cwd: "/elsewhere" }) + "\n" + userMsg("nope") + "\n");
    const out = await extractFirstPrompts(CWD, root);
    assert.deepEqual(out.map(r => r.sessionId), ["grouped"]);
    assert.equal((out[0] as { prompt: string }).prompt, "found via group");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown store layout falls back to full-store scan with cwd filter", async () => {
  // A sessions root without the projectKey group dir (custom root / older DSH):
  // extraction must still find the workspace's sessions by scanning everything.
  const root = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    // deliberately NOT named like projectKey(CWD)
    const flat = join(root, "flat-group");
    const dir = join(flat, "s1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.jsonl"), header({ id: "s1" }) + "\n" + userMsg("flat layout hit") + "\n");
    const out = await extractFirstPrompts(CWD, root);
    assert.deepEqual(out.map(r => r.prompt), ["flat layout hit"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projectKey matches the DSH on-disk directory naming", async () => {
  const { projectKey } = await import("../lib/extract.js");
  assert.equal(projectKey("/home/andre/git/Moving target "), "--home-andre-git-Moving~0020target~0020--");
  assert.equal(projectKey("/tmp/proj "), "--tmp-proj~0020--");
});
