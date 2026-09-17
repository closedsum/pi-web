import assert from "node:assert/strict";
import test from "node:test";

const KEEPS_BOARD = new Set(["resume", "compact"]);

function isClosed(status) {
  return status === "completed" || status === "deleted" || status === "cancelled";
}

function boardState(payload, boardTasks) {
  if (boardTasks !== undefined) {
    if (!Array.isArray(boardTasks)) return { empty: true, error: "no task array" };
    return { empty: !boardTasks.some((t) => !isClosed(t?.status)), reason: "board state file" };
  }
  const source = String(payload?.source ?? "");
  return { empty: !KEEPS_BOARD.has(source), reason: `source=${source || "unknown"}` };
}

function liveRows(snapshot) {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.filter((row) => !isClosed(row?.status));
}

function shouldRestore(payload, boardTasks, snapshot) {
  const state = boardState(payload, boardTasks);
  const rows = liveRows(snapshot);
  if (!rows.length || !state.empty) return { restore: false, reason: state.reason };
  return { restore: true, rows, reason: state.reason };
}

test("board is empty on startup source", () => {
  const state = boardState({ source: "startup" });
  assert.ok(state.empty);
});

test("board is empty on clear source", () => {
  const state = boardState({ source: "clear" });
  assert.ok(state.empty);
});

test("board is kept on resume source", () => {
  const state = boardState({ source: "resume" });
  assert.ok(!state.empty);
});

test("board is kept on compact source", () => {
  const state = boardState({ source: "compact" });
  assert.ok(!state.empty);
});

test("board is empty on unknown source", () => {
  const state = boardState({});
  assert.ok(state.empty);
});

test("board with all closed tasks is empty", () => {
  const tasks = [{ status: "completed" }, { status: "deleted" }];
  const state = boardState({}, tasks);
  assert.ok(state.empty);
});

test("board with open tasks is not empty", () => {
  const tasks = [{ status: "in_progress" }, { status: "completed" }];
  const state = boardState({}, tasks);
  assert.ok(!state.empty);
});

test("board with pending tasks is not empty", () => {
  const tasks = [{ status: "pending" }];
  const state = boardState({}, tasks);
  assert.ok(!state.empty);
});

test("isClosed recognizes terminal states", () => {
  assert.ok(isClosed("completed"));
  assert.ok(isClosed("deleted"));
  assert.ok(isClosed("cancelled"));
  assert.ok(!isClosed("in_progress"));
  assert.ok(!isClosed("pending"));
  assert.ok(!isClosed(undefined));
});

test("liveRows filters out closed rows", () => {
  const snapshot = [
    { id: 1, status: "in_progress" },
    { id: 2, status: "completed" },
    { id: 3, status: "pending" },
  ];
  const live = liveRows(snapshot);
  assert.equal(live.length, 2);
  assert.deepEqual(live.map((r) => r.id), [1, 3]);
});

test("liveRows returns empty for null snapshot", () => {
  assert.deepEqual(liveRows(null), []);
  assert.deepEqual(liveRows(undefined), []);
});

test("shouldRestore triggers when board empty and snapshot has live rows", () => {
  const result = shouldRestore(
    { source: "startup" },
    undefined,
    [{ id: 1, status: "in_progress" }],
  );
  assert.ok(result.restore);
  assert.equal(result.rows.length, 1);
});

test("shouldRestore skips when board is not empty (resume)", () => {
  const result = shouldRestore(
    { source: "resume" },
    undefined,
    [{ id: 1, status: "in_progress" }],
  );
  assert.ok(!result.restore);
});

test("shouldRestore skips when snapshot has no live rows", () => {
  const result = shouldRestore(
    { source: "startup" },
    undefined,
    [{ status: "completed" }],
  );
  assert.ok(!result.restore);
});

test("shouldRestore skips when board file has open tasks", () => {
  const result = shouldRestore(
    {},
    [{ status: "in_progress" }],
    [{ id: 1, status: "pending" }],
  );
  assert.ok(!result.restore);
});

test("boardState errors on non-array board tasks", () => {
  const state = boardState({}, "not-an-array");
  assert.ok(state.empty);
  assert.ok(state.error);
});
