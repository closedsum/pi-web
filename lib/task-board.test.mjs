import assert from "node:assert/strict";
import test from "node:test";
import { parseBoard, countByStatus } from "./task-board.ts";

test("parseBoard extracts tasks from JSONL lines", () => {
  const lines = [
    '{"id":"1","subject":"[PENDING] Fix bug","description":"desc","status":"pending","blockedBy":[],"blocks":[],"metadata":{},"owner":"","session_id":"s1","created_at":"2026-09-16T00:00:00Z","completed_at":null}',
    '{"id":"2","subject":"[DONE] Add feature","description":"","status":"completed","blockedBy":[],"blocks":[],"metadata":{},"owner":"","session_id":"s2","created_at":"2026-09-16T00:00:00Z","completed_at":"2026-09-16T01:00:00Z"}',
    "",
    "not json",
  ];
  const tasks = parseBoard(lines);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].subject, "[PENDING] Fix bug");
  assert.equal(tasks[1].status, "completed");
});

test("parseBoard skips entries with empty subject", () => {
  const lines = [
    '{"id":"1","subject":"","description":"","status":"completed","blockedBy":[],"blocks":[],"metadata":{},"owner":"","session_id":"s1","created_at":"2026-09-16T00:00:00Z","completed_at":null}',
    '{"id":"2","subject":"[PENDING] Real task","description":"","status":"pending","blockedBy":[],"blocks":[],"metadata":{},"owner":"","session_id":"s2","created_at":"2026-09-16T00:00:00Z","completed_at":null}',
  ];
  const tasks = parseBoard(lines);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].subject, "[PENDING] Real task");
});

test("countByStatus tallies tasks correctly", () => {
  const tasks = [
    { status: "pending" },
    { status: "pending" },
    { status: "in_progress" },
    { status: "completed" },
    { status: "completed" },
    { status: "completed" },
  ];
  const counts = countByStatus(tasks);
  assert.equal(counts.pending, 2);
  assert.equal(counts.in_progress, 1);
  assert.equal(counts.completed, 3);
});

test("parseBoard handles empty input", () => {
  assert.equal(parseBoard([]).length, 0);
  assert.equal(parseBoard([""]).length, 0);
  assert.equal(parseBoard(["  "]).length, 0);
});

function makeLine(id, sessionId, createdAt, status = "pending") {
  return JSON.stringify({
    id, subject: `Task ${id}`, description: "", status,
    blockedBy: [], blocks: [], metadata: {}, owner: "",
    session_id: sessionId, created_at: createdAt,
    completed_at: status === "completed" ? createdAt : null,
  });
}

test("session time filter: tasks before mount time are excluded", () => {
  const mountTime = "2026-09-21T20:00:00Z";
  const lines = [
    makeLine("1", "s-old", "2026-09-21T15:00:00Z"),
    makeLine("2", "s-old", "2026-09-21T18:00:00Z", "completed"),
    makeLine("3", "s-new", "2026-09-21T20:30:00Z"),
    makeLine("4", "s-new", "2026-09-21T21:00:00Z", "in_progress"),
  ];
  const tasks = parseBoard(lines);
  const sessionTasks = tasks.filter(t => t.created_at >= mountTime);
  assert.equal(sessionTasks.length, 2);
  assert.equal(sessionTasks[0].id, "3");
  assert.equal(sessionTasks[1].id, "4");
});

test("session time filter: fresh mount excludes all old tasks", () => {
  const mountTime = new Date().toISOString();
  const lines = [
    makeLine("1", "s1", "2026-09-21T10:00:00Z"),
    makeLine("2", "s2", "2026-09-21T12:00:00Z"),
  ];
  const tasks = parseBoard(lines);
  const sessionTasks = tasks.filter(t => t.created_at >= mountTime);
  assert.equal(sessionTasks.length, 0);
});

test("session time filter: new task after mount passes filter", () => {
  const mountTime = "2026-09-21T20:00:00Z";
  const lines = [
    makeLine("1", "s-old", "2026-09-21T15:00:00Z"),
  ];
  const tasks = parseBoard(lines);

  const futureLine = makeLine("2", "s-new", "2026-09-21T20:05:00Z");
  const allTasks = parseBoard([...lines, futureLine]);
  const sessionTasks = allTasks.filter(t => t.created_at >= mountTime);
  assert.equal(sessionTasks.length, 1);
  assert.equal(sessionTasks[0].id, "2");
});
