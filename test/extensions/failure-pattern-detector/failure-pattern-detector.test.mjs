import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent } from "../_config.mjs";

const LANE_COMMAND_RE = /gsd_impl_lane\.py\s+(?:list|status|run|wait)\b/i;

function matchesLaneCommand(cmd) {
  return LANE_COMMAND_RE.test(cmd);
}

function normalizeLanes(stdout) {
  if (!stdout) return [];
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.lanes)) return parsed.lanes;
    if (parsed && typeof parsed === "object" && parsed.slug) return [parsed];
    return [];
  } catch {
    return [];
  }
}

function extractFailures(lanes) {
  const failures = [];
  for (const lane of lanes) {
    const cls = lane.failure_class || lane.last_round?.failure_class;
    if (cls) failures.push({ slug: lane.slug, failure_class: cls });
  }
  return failures;
}

function accumulateFailures(state, failures, sessionId) {
  const updated = { ...state };
  const newGaps = [];
  for (const f of failures) {
    const key = `${sessionId}:${f.failure_class}`;
    updated[key] = (updated[key] || 0) + 1;
    if (updated[key] >= 2 && !updated[`${key}:filed`]) {
      newGaps.push(f.failure_class);
      updated[`${key}:filed`] = true;
    }
  }
  return { state: updated, newGaps };
}

function gapTaskId(sessionId, failureClass) {
  const input = `${sessionId}${failureClass}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `gap-${Math.abs(hash).toString(16)}`;
}

test("matchesLaneCommand detects list", () => {
  assert.ok(matchesLaneCommand("python gsd_impl_lane.py list --repo ."));
});

test("matchesLaneCommand detects status", () => {
  assert.ok(matchesLaneCommand("python gsd_impl_lane.py status"));
});

test("matchesLaneCommand ignores pipeline", () => {
  assert.ok(!matchesLaneCommand("python gsd_impl_lane.py pipeline --params x"));
});

test("matchesLaneCommand ignores non-lane commands", () => {
  assert.ok(!matchesLaneCommand("npm test"));
});

test("normalizeLanes handles array", () => {
  const result = normalizeLanes('[{"slug":"a"},{"slug":"b"}]');
  assert.equal(result.length, 2);
});

test("normalizeLanes handles {lanes:[...]}", () => {
  const result = normalizeLanes('{"lanes":[{"slug":"a"}]}');
  assert.equal(result.length, 1);
});

test("normalizeLanes handles single object", () => {
  const result = normalizeLanes('{"slug":"a","status":"finished"}');
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "a");
});

test("normalizeLanes returns empty for null", () => {
  assert.deepEqual(normalizeLanes(null), []);
});

test("normalizeLanes returns empty for invalid JSON", () => {
  assert.deepEqual(normalizeLanes("not json"), []);
});

test("extractFailures finds top-level failure_class", () => {
  const lanes = [{ slug: "a", failure_class: "commit_gate_blocked" }];
  const failures = extractFailures(lanes);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failure_class, "commit_gate_blocked");
});

test("extractFailures finds nested last_round.failure_class", () => {
  const lanes = [{ slug: "b", last_round: { failure_class: "drift" } }];
  const failures = extractFailures(lanes);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failure_class, "drift");
});

test("extractFailures skips lanes without failures", () => {
  const lanes = [{ slug: "c", status: "finished" }];
  assert.deepEqual(extractFailures(lanes), []);
});

test("accumulateFailures files gap at threshold", () => {
  const failures = [
    { slug: "a", failure_class: "drift" },
    { slug: "b", failure_class: "drift" },
  ];
  const { state, newGaps } = accumulateFailures({}, failures, "sess1");
  assert.equal(newGaps.length, 1);
  assert.equal(newGaps[0], "drift");
  assert.ok(state["sess1:drift:filed"]);
});

test("accumulateFailures does not re-file same class", () => {
  const initial = { "sess1:drift": 3, "sess1:drift:filed": true };
  const failures = [{ slug: "c", failure_class: "drift" }];
  const { newGaps } = accumulateFailures(initial, failures, "sess1");
  assert.equal(newGaps.length, 0);
});

test("accumulateFailures tracks different classes independently", () => {
  const failures = [
    { slug: "a", failure_class: "drift" },
    { slug: "b", failure_class: "capacity" },
  ];
  const { state } = accumulateFailures({}, failures, "sess1");
  assert.equal(state["sess1:drift"], 1);
  assert.equal(state["sess1:capacity"], 1);
});

test("gapTaskId is deterministic", () => {
  const id1 = gapTaskId("sess1", "drift");
  const id2 = gapTaskId("sess1", "drift");
  assert.equal(id1, id2);
});

test("gapTaskId differs for different inputs", () => {
  assert.notEqual(gapTaskId("sess1", "drift"), gapTaskId("sess1", "capacity"));
  assert.notEqual(gapTaskId("sess1", "drift"), gapTaskId("sess2", "drift"));
});
