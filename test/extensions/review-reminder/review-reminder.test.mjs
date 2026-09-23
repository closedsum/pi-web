import assert from "node:assert/strict";
import test from "node:test";
import { TEST_CONFIG } from "../_config.mjs";

function handleToolResult(event, state) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const output = event.output || "";
  const commitMatch = /\[[\w/.-]+\s+[0-9a-f]{7}\]/.test(output);
  if (commitMatch) {
    state.uncommittedLines = countUncommittedLines(output);
    if (state.uncommittedLines > 200) {
      return { inject: `[REVIEW-REMINDER] Commit/push with ${state.uncommittedLines} uncommitted lines. Run /gsd:cross-review before committing.` };
    }
  }
  return undefined;
}

function countUncommittedLines(output) {
  const match = output.match(/(\d+) uncommitted lines/);
  return match ? parseInt(match[1], 10) : 0;
}

test("injects review reminder when uncommitted lines exceed threshold", () => {
  const event = { tool: "Bash", output: "[main abc1234] fix: thing\n445 uncommitted lines" };
  const state = {};
  const result = handleToolResult(event, state);
  assert.ok(result?.inject);
  assert.match(result.inject, /cross-review/);
  assert.equal(state.uncommittedLines, 445);
});

test("does not inject for small commits", () => {
  const event = { tool: "Bash", output: "[main def5678] docs: readme\n50 uncommitted lines" };
  const state = {};
  const result = handleToolResult(event, state);
  assert.equal(result, undefined);
});

test("does not trigger for non-commit output", () => {
  const event = { tool: "Bash", output: "On branch main\nnothing to commit" };
  const state = {};
  const result = handleToolResult(event, state);
  assert.equal(result, undefined);
});

test("test config defaults to gpt-6-sol high", (t) => {
  if (process.env.PI_TEST_MODEL || process.env.PI_TEST_EFFORT) {
    t.skip("PI_TEST_MODEL/PI_TEST_EFFORT override set");
    return;
  }
  assert.equal(TEST_CONFIG.model, "gpt-6-sol");
  assert.equal(TEST_CONFIG.effort, "high");
});
