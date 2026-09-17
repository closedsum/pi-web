import assert from "node:assert/strict";
import test from "node:test";

const VALID_EVENTS = new Set(["SessionStart", "Stop", "SessionEnd"]);

function handleSessionEvent(event, repos = []) {
  if (!VALID_EVENTS.has(event)) return { error: `unsupported event: ${event}` };
  const results = [];
  for (const repo of repos) {
    if (!repo.hasLaneState) continue;
    results.push({ repo: repo.path, swept: repo.processesSwept || 0 });
  }
  if (!results.length) return undefined;
  return { swept: results.reduce((sum, r) => sum + r.swept, 0), repos: results };
}

test("sweeps processes on SessionStart", () => {
  const result = handleSessionEvent("SessionStart", [
    { path: "D:\\project", hasLaneState: true, processesSwept: 3 },
  ]);
  assert.equal(result.swept, 3);
});

test("sweeps across multiple repos", () => {
  const result = handleSessionEvent("SessionEnd", [
    { path: "D:\\p1", hasLaneState: true, processesSwept: 2 },
    { path: "D:\\p2", hasLaneState: true, processesSwept: 1 },
  ]);
  assert.equal(result.swept, 3);
  assert.equal(result.repos.length, 2);
});

test("skips repos without lane state", () => {
  const result = handleSessionEvent("SessionStart", [
    { path: "D:\\no-lanes", hasLaneState: false },
  ]);
  assert.equal(result, undefined);
});

test("rejects unsupported events", () => {
  const result = handleSessionEvent("PostToolUse", []);
  assert.ok(result?.error);
  assert.match(result.error, /unsupported/);
});

test("handles Stop event", () => {
  const result = handleSessionEvent("Stop", [
    { path: "D:\\p1", hasLaneState: true, processesSwept: 0 },
  ]);
  assert.equal(result.swept, 0);
});
