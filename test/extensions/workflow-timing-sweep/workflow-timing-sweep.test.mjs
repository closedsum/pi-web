import assert from "node:assert/strict";
import test from "node:test";

function handleSessionStart(sweepResult) {
  if (!sweepResult) return undefined;
  const closed = sweepResult.closed || [];
  const errors = sweepResult.errors || [];
  if (!closed.length && !errors.length) return undefined;
  return {
    inject: `[TIMING-SWEEP] closed=${closed.length} kept=${sweepResult.kept || 0} errors=${errors.length}`,
  };
}

test("reports closed timers on session start", () => {
  const result = handleSessionStart({ closed: [{ key: "a" }, { key: "b" }], kept: 5, errors: [] });
  assert.ok(result?.inject);
  assert.match(result.inject, /closed=2/);
  assert.match(result.inject, /kept=5/);
});

test("returns undefined when nothing to report", () => {
  assert.equal(handleSessionStart({ closed: [], kept: 10, errors: [] }), undefined);
});

test("reports errors", () => {
  const result = handleSessionStart({ closed: [], kept: 0, errors: ["timeout"] });
  assert.ok(result?.inject);
  assert.match(result.inject, /errors=1/);
});

test("handles null sweep result", () => {
  assert.equal(handleSessionStart(null), undefined);
});
