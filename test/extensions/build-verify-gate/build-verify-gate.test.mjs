import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event, state = {}) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (!/\bgit\b[^\n;|&]*\bcommit\b/i.test(cmd)) return undefined;
  if (!state.buildPending) return undefined;
  const since = state.lastCommitMinutes ? ` (last commit ${state.lastCommitMinutes}m ago)` : "";
  return {
    block: false,
    reason: `[BUILD-VERIFY] No build verification since last commit${since}. Run ue_action.py build (or test suite) before this commit, or proceed if this commit is docs/planning only.`,
  };
}

test("warns on git commit when build is pending", () => {
  const event = makeBashToolCallEvent('git commit -m "fix: thing"');
  const result = handleToolCall(event, { buildPending: true, lastCommitMinutes: 15 });
  assert.ok(result);
  assert.match(result.reason, /BUILD-VERIFY/);
  assert.match(result.reason, /15m ago/);
  assert.equal(result.block, false);
});

test("passes when no build is pending", () => {
  const event = makeBashToolCallEvent('git commit -m "feat: new"');
  const result = handleToolCall(event, { buildPending: false });
  assertPassed(result);
});

test("ignores non-commit git commands", () => {
  const event = makeBashToolCallEvent("git status");
  const result = handleToolCall(event, { buildPending: true });
  assertPassed(result);
});

test("ignores non-shell tools", () => {
  const event = { tool: "Read", input: { command: "git commit" } };
  const result = handleToolCall(event, { buildPending: true });
  assertPassed(result);
});

test("warns without elapsed time when not provided", () => {
  const event = makeBashToolCallEvent('git commit -m "docs: update"');
  const result = handleToolCall(event, { buildPending: true });
  assert.ok(result);
  assert.match(result.reason, /BUILD-VERIFY/);
  assert.ok(!result.reason.includes("m ago"));
});
