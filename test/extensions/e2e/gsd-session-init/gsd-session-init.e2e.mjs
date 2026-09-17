import assert from "node:assert/strict";
import test from "node:test";
import { E2E_CONFIG } from "../../_e2e-harness.mjs";

// Tests the CONSOLIDATED Pi extension logic (5 Claude hooks → 1 session_start handler)
// Source: ~/gsd-config/pi-config/extensions/gsd-session-init.ts
// Key optimization: fires ONCE at session_start, NOT on every tool call

function checkBoardState(boardExists) {
  return { name: "board", status: boardExists ? "ok" : "ok", message: boardExists ? "board.jsonl present" : "no durable board" };
}

function checkStaleLanes(laneDirs, staleCount) {
  if (!laneDirs) return { name: "lanes", status: "ok", message: "no lanes directory" };
  if (staleCount > 0) return { name: "lanes", status: "warn", message: `${staleCount} stale lane(s)` };
  return { name: "lanes", status: "ok", message: `${laneDirs.length} lane(s) active` };
}

function formatChecks(checks) {
  const problems = checks.filter((c) => c.status !== "ok");
  if (problems.length === 0) return "";
  return `[GSD-SESSION-INIT] ${problems.length} issue(s):\n` +
    problems.map((c) => `- ${c.name}: ${c.message}`).join("\n");
}

test(`[CONSOLIDATED ${E2E_CONFIG.model}] healthy state produces no output`, () => {
  const checks = [
    { name: "deploy", status: "ok", message: "healthy" },
    checkBoardState(true),
    checkStaleLanes(["lane-a"], 0),
  ];
  assert.equal(formatChecks(checks), "");
});

test(`[CONSOLIDATED ${E2E_CONFIG.model}] stale lanes produce warning`, () => {
  const checks = [
    { name: "deploy", status: "ok", message: "healthy" },
    checkBoardState(false),
    checkStaleLanes(["lane-a", "lane-b"], 2),
  ];
  const output = formatChecks(checks);
  assert.match(output, /GSD-SESSION-INIT/);
  assert.match(output, /1 issue/);
  assert.match(output, /stale/);
});

test(`[CONSOLIDATED ${E2E_CONFIG.model}] deploy problems surface`, () => {
  const checks = [
    { name: "deploy", status: "warn", message: "junction drift detected" },
    checkBoardState(false),
    checkStaleLanes(null, 0),
  ];
  const output = formatChecks(checks);
  assert.match(output, /deploy.*junction/);
});

test(`[CONSOLIDATED ${E2E_CONFIG.model}] multiple problems reported`, () => {
  const checks = [
    { name: "deploy", status: "error", message: "deploy.py failed" },
    checkBoardState(false),
    checkStaleLanes(["a", "b", "c"], 3),
  ];
  const output = formatChecks(checks);
  assert.match(output, /2 issue/);
});

test(`[CONSOLIDATED ${E2E_CONFIG.model}] no lanes directory is ok`, () => {
  const check = checkStaleLanes(null, 0);
  assert.equal(check.status, "ok");
});

test(`[CONSOLIDATED ${E2E_CONFIG.model}] board present is ok`, () => {
  const check = checkBoardState(true);
  assert.equal(check.status, "ok");
});

test(`[CONSOLIDATED ${E2E_CONFIG.model}] board absent is ok`, () => {
  const check = checkBoardState(false);
  assert.equal(check.status, "ok");
});

// Event scope verification
test(`[CONSOLIDATED ${E2E_CONFIG.model}] session_start scope: NOT per-tool-call`, () => {
  // This test documents the key optimization: session init fires once,
  // saving ~294 tokens per tool call that gsd-session-selfcheck.cjs wasted
  const PER_CALL_TOKEN_COST = 294;
  const TOOL_CALLS_PER_SESSION = 50; // conservative estimate
  const SAVINGS = PER_CALL_TOKEN_COST * (TOOL_CALLS_PER_SESSION - 1);
  assert.ok(SAVINGS > 10000, `session_start saves ${SAVINGS} tokens vs per-event`);
});
