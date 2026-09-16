import assert from "node:assert/strict";
import test from "node:test";
import { parseBoard, countByStatus } from "./gsd-board.ts";

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
