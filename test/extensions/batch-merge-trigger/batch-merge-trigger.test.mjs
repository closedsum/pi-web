import assert from "node:assert/strict";
import test from "node:test";

const DEFAULT_THRESHOLD = 10;

function shouldNotify(slugs, threshold, lastNotified = []) {
  if (slugs.length < threshold) return false;
  const a = [...slugs].sort();
  const b = [...lastNotified].sort();
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

function buildNotice(slugs, threshold) {
  return `[BATCH-MERGE] ${slugs.length} accepted lane(s) at/above threshold ${threshold}: ${slugs.join(", ")}`;
}

test("notifies when slugs reach threshold", () => {
  const slugs = Array.from({ length: 10 }, (_, i) => `lane-${i}`);
  assert.ok(shouldNotify(slugs, 10, []));
});

test("does not notify below threshold", () => {
  assert.ok(!shouldNotify(["a", "b"], 10, []));
});

test("does not re-notify with same slug set", () => {
  const slugs = ["a", "b", "c"];
  assert.ok(!shouldNotify(slugs, 3, ["a", "b", "c"]));
});

test("re-notifies when slug set changes", () => {
  assert.ok(shouldNotify(["a", "b", "c", "d"], 3, ["a", "b", "c"]));
});

test("formats notice correctly", () => {
  const notice = buildNotice(["fix-auth", "add-tests"], 2);
  assert.match(notice, /BATCH-MERGE/);
  assert.match(notice, /fix-auth/);
  assert.match(notice, /add-tests/);
});
