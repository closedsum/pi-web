import assert from "node:assert/strict";
import test from "node:test";

function handleSessionStart(state = {}) {
  if (!state.hasLaneState) return undefined;
  const orphaned = state.orphanedLanes || 0;
  const stale = state.staleLanes || 0;
  const alive = state.aliveLanes || 0;
  return {
    inject: `[LANE-SWEEP] orphaned=${orphaned} stale=${stale} alive=${alive}`,
  };
}

test("reports lane sweep results on session start", () => {
  const result = handleSessionStart({ hasLaneState: true, orphanedLanes: 2, staleLanes: 1, aliveLanes: 3 });
  assert.ok(result?.inject);
  assert.match(result.inject, /LANE-SWEEP/);
  assert.match(result.inject, /orphaned=2/);
});

test("returns undefined when no lane state directory", () => {
  assert.equal(handleSessionStart({ hasLaneState: false }), undefined);
});

test("reports zeros when no orphaned or stale lanes", () => {
  const result = handleSessionStart({ hasLaneState: true, orphanedLanes: 0, staleLanes: 0, aliveLanes: 5 });
  assert.match(result.inject, /orphaned=0/);
  assert.match(result.inject, /alive=5/);
});
