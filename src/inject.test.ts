import { test } from "node:test";
import assert from "node:assert/strict";
import { injectionText } from "../lib/inject.js";
import type { StoredSummary } from "../lib/summary.js";

const stored: StoredSummary = {
  summary: "Build the moving-target DSH plugin.",
  meta: { bootstrappedAt: "2026-08-23T00:00:00.000Z", sessionCount: 4 },
};
const topHeader = { cwd: "/ws", delegationDepth: 0 };

test("injects bootstrapped summary for top-level startup session", () => {
  const t = injectionText(topHeader, stored, "startup");
  assert.ok(t?.startsWith("Project goal (moving-target, bootstrapped 2026-08-23T00:00:00.000Z): "));
  assert.ok(t?.endsWith("Build the moving-target DSH plugin."));
});

test("no-op when not bootstrapped, no cwd, or no header", () => {
  assert.equal(injectionText(topHeader, null), null);
  assert.equal(injectionText({ cwd: undefined }, stored), null);
  assert.equal(injectionText(undefined, stored), null);
});

test("skips subagent sessions (delegationDepth or origin)", () => {
  assert.equal(injectionText({ cwd: "/ws", delegationDepth: 1 }, stored), null);
  assert.equal(injectionText({ cwd: "/ws", delegationDepth: 2 }, stored), null);
  assert.equal(injectionText({ cwd: "/ws", origin: "subagent" }, stored), null);
  // origin subagent with depth 0 still excluded
  assert.equal(injectionText({ cwd: "/ws", delegationDepth: 0, origin: "subagent" }, stored), null);
});

test("delegationDepth absent (undefined) is top-level — still injects", () => {
  assert.ok(injectionText({ cwd: "/ws" }, stored)); // no delegationDepth field at all
});

test("injects only on startup, not resume/clear/compact", () => {
  for (const source of ["resume", "clear", "compact"] as const) {
    assert.equal(injectionText(topHeader, stored, source), null, source);
  }
  assert.ok(injectionText(topHeader, stored, "startup"));
});

test("missing/empty bootstrappedAt in stored summary = not bootstrapped", () => {
  assert.equal(injectionText(topHeader, { summary: "s", meta: { bootstrappedAt: "", sessionCount: 1 } }), null);
  assert.equal(injectionText(topHeader, { summary: "s", meta: { bootstrappedAt: "", sessionCount: 1 } }, "startup"), null);
});
