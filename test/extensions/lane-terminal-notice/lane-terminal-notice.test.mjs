import assert from "node:assert/strict";
import test from "node:test";

const TERMINAL_STATUSES = new Set(["finished", "failed", "timed_out", "cancelled", "integrated", "blocked", "preflight_failed"]);

function normalizeLanes(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.lanes)) return parsed.lanes;
  if (parsed && typeof parsed === "object" && typeof parsed.slug === "string") return [parsed];
  return [];
}

function buildNotice(lanes) {
  const terminal = lanes.filter(l => TERMINAL_STATUSES.has(l.status));
  if (!terminal.length) return undefined;
  return terminal.map(l => `[LANE-TERMINAL] ${l.slug} ${l.status}`).join("\n");
}

test("formats terminal lane notices", () => {
  const lanes = [
    { slug: "fix-auth", status: "finished" },
    { slug: "add-tests", status: "failed" },
  ];
  const notice = buildNotice(lanes);
  assert.match(notice, /fix-auth finished/);
  assert.match(notice, /add-tests failed/);
});

test("skips non-terminal lanes", () => {
  const lanes = [{ slug: "running-task", status: "running" }];
  assert.equal(buildNotice(lanes), undefined);
});

test("normalizes lanes from list shape", () => {
  const parsed = { lanes: [{ slug: "a", status: "finished" }] };
  assert.deepEqual(normalizeLanes(parsed), [{ slug: "a", status: "finished" }]);
});

test("normalizes single lane object", () => {
  const parsed = { slug: "b", status: "failed" };
  assert.deepEqual(normalizeLanes(parsed), [{ slug: "b", status: "failed" }]);
});

test("handles all terminal statuses", () => {
  for (const status of TERMINAL_STATUSES) {
    const notice = buildNotice([{ slug: "test", status }]);
    assert.ok(notice, `should report ${status}`);
    assert.match(notice, new RegExp(status));
  }
});
