import assert from "node:assert/strict";
import test from "node:test";

function handleToolResult(event, state = {}) {
  const cmd = event.input?.command || "";
  const exitCode = event.exitCode;
  if (exitCode !== 0 && exitCode !== undefined) return undefined;
  if (/\bgit\b[^\n;|&]*\bcommit\b/i.test(cmd) && !/--amend\b/i.test(cmd)) {
    state.buildPending = true;
    state.commitTime = Date.now();
    return { inject: "[BUILD-VERIFY] Commit recorded. Run build verification before next commit." };
  }
  if (/\bue_action(?:\.py)?\s+build\b/i.test(cmd) || /\bnpm\s+test\b/i.test(cmd)) {
    state.buildPending = false;
    return undefined;
  }
  return undefined;
}

test("sets buildPending on git commit", () => {
  const state = {};
  const result = handleToolResult({ input: { command: 'git commit -m "fix"' }, exitCode: 0 }, state);
  assert.ok(result?.inject);
  assert.equal(state.buildPending, true);
});

test("clears buildPending on build command", () => {
  const state = { buildPending: true };
  handleToolResult({ input: { command: "python ue_action.py build" }, exitCode: 0 }, state);
  assert.equal(state.buildPending, false);
});

test("clears buildPending on npm test", () => {
  const state = { buildPending: true };
  handleToolResult({ input: { command: "npm test" }, exitCode: 0 }, state);
  assert.equal(state.buildPending, false);
});

test("does not set on failed commit", () => {
  const state = {};
  handleToolResult({ input: { command: 'git commit -m "fix"' }, exitCode: 1 }, state);
  assert.equal(state.buildPending, undefined);
});

test("does not set on git commit --amend", () => {
  const state = {};
  handleToolResult({ input: { command: "git commit --amend" }, exitCode: 0 }, state);
  assert.equal(state.buildPending, undefined);
});
