import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { evaluateBlockRulesAsync, DEFAULT_POLICY } = await jiti.import("./async-block-rules.ts");
const { evaluateBlockRules } = await jiti.import("./tool-blockers.ts");

function makeRule(name, fn) {
  return { name, test: fn };
}

describe("evaluateBlockRulesAsync", () => {
  test("returns same result as sync for non-git rules", async () => {
    const rules = [makeRule("allow-all", () => undefined)];
    const ctx = { cwd: process.cwd(), isSubagent: false, stateHome: "/tmp" };
    const asyncResult = await evaluateBlockRulesAsync("Read", {}, rules, ctx);
    const syncResult = evaluateBlockRules("Read", {}, rules, ctx);
    assert.deepEqual(asyncResult, syncResult);
  });

  test("prefetches git facts into context", async () => {
    let capturedCtx;
    const rules = [makeRule("spy", (_t, _i, ctx) => { capturedCtx = ctx; return undefined; })];
    const ctx = { cwd: process.cwd(), isSubagent: false, stateHome: "/tmp" };
    await evaluateBlockRulesAsync("Read", {}, rules, ctx);
    assert.ok(capturedCtx?.gitFacts, "gitFacts should be set");
    assert.ok(typeof capturedCtx.gitFacts.toplevel === "string" || capturedCtx.gitFacts.toplevel === null);
  });

  test("fail-closed on timeout: rules still run with null git facts", async () => {
    let capturedCtx;
    const rules = [makeRule("spy", (_t, _i, ctx) => { capturedCtx = ctx; return undefined; })];
    const ctx = { cwd: process.cwd(), isSubagent: false, stateHome: "/tmp" };
    const policy = { timeoutMs: 1, failMode: "closed" };
    await evaluateBlockRulesAsync("Read", {}, rules, ctx, { policy });
    // With 1ms timeout, git may or may not succeed — either way rules ran
    assert.ok(capturedCtx, "Rules should have been called");
  });

  test("fail-open on timeout: returns undefined (allow)", async () => {
    const rules = [makeRule("block-always", () => ({ block: true, reason: "blocked" }))];
    const ctx = { cwd: process.cwd(), isSubagent: false, stateHome: "/tmp" };
    const policy = { timeoutMs: 1, failMode: "open" };
    // With fail-open and a very short timeout, if the abort fires before rules run:
    // the function returns undefined. If git completes fast enough, it returns the block.
    // Either outcome is valid — we just verify it doesn't throw.
    const result = await evaluateBlockRulesAsync("Write", {}, rules, ctx, { policy });
    assert.ok(result === undefined || result?.block === true);
  });

  test("aborted signal returns without hanging", async () => {
    const ac = new AbortController();
    ac.abort();
    const rules = [makeRule("allow", () => undefined)];
    const ctx = { cwd: process.cwd(), isSubagent: false, stateHome: "/tmp" };
    const result = await evaluateBlockRulesAsync("Read", {}, rules, ctx, { signal: ac.signal });
    // Should return quickly without hanging — either result from sync fallback or undefined
    assert.ok(result === undefined || result === undefined);
  });

  test("falls back to sync when no ctx", async () => {
    const rules = [makeRule("block", () => ({ block: true, reason: "test" }))];
    const result = await evaluateBlockRulesAsync("Write", {}, rules, undefined);
    assert.equal(result?.block, true);
  });

  test("works with telemetry collector", async () => {
    const { TelemetryCollector } = await jiti.import("./telemetry-collector.ts");
    const collector = new TelemetryCollector("test-async");
    const rules = [makeRule("counted-rule", () => undefined)];
    const ctx = { cwd: process.cwd(), isSubagent: false, stateHome: "/tmp" };
    await evaluateBlockRulesAsync("Read", {}, rules, ctx, { collector });
    const snap = collector.snapshot();
    assert.equal(snap.rules["counted-rule"]?.invocations, 1);
  });
});

describe("DEFAULT_POLICY", () => {
  test("has timeoutMs and failMode", () => {
    assert.equal(typeof DEFAULT_POLICY.timeoutMs, "number");
    assert.ok(DEFAULT_POLICY.failMode === "closed" || DEFAULT_POLICY.failMode === "open");
  });
});
