import assert from "node:assert/strict";
import test from "node:test";

function readFlag(flagState) {
  return flagState;
}

function handleToolResult(event, flagState, isSubagent = false) {
  if (isSubagent) return undefined;

  const tool = event.tool || "";
  const input = event.input || {};

  if (tool === "TaskCreate") {
    if (flagState === null || flagState === undefined) {
      return {
        flag: "pending",
        inject: "[PARALLEL-DISPATCH] TaskCreate detected. Continue creating tasks, then invoke /gsd:parallel-tasks to dispatch as a wave.",
      };
    }
    return { flag: flagState };
  }

  if (tool === "Skill" && /parallel.tasks/i.test(input.skill || "")) {
    return {
      flag: null,
      inject: "[PARALLEL-DISPATCH] Manifest ready. Use it as Zone A for wave dispatch.",
    };
  }

  if (flagState === "pending") {
    return {
      flag: "manifest-emitted",
      inject: "[PARALLEL-DISPATCH] Task burst ended. Manifest injected. Invoke /gsd:parallel-tasks to dispatch.",
    };
  }

  if ((flagState === null || flagState === "manifest-emitted") && tool === "TaskUpdate") {
    return { flag: flagState, refresh: true };
  }

  return undefined;
}

test("first TaskCreate sets pending flag", () => {
  const result = handleToolResult({ tool: "TaskCreate", input: { subject: "task 1" } }, null);
  assert.equal(result.flag, "pending");
  assert.match(result.inject, /PARALLEL-DISPATCH/);
});

test("subsequent TaskCreate keeps existing flag", () => {
  const result = handleToolResult({ tool: "TaskCreate", input: { subject: "task 2" } }, "pending");
  assert.equal(result.flag, "pending");
  assert.ok(!result.inject);
});

test("parallel-tasks skill clears flag", () => {
  const result = handleToolResult({ tool: "Skill", input: { skill: "gsd:parallel-tasks" } }, "pending");
  assert.equal(result.flag, null);
  assert.match(result.inject, /Manifest ready/);
});

test("non-TaskCreate tool while pending emits manifest", () => {
  const result = handleToolResult({ tool: "Edit", input: {} }, "pending");
  assert.equal(result.flag, "manifest-emitted");
  assert.match(result.inject, /burst ended/);
});

test("TaskUpdate after manifest triggers refresh", () => {
  const result = handleToolResult({ tool: "TaskUpdate", input: {} }, "manifest-emitted");
  assert.ok(result.refresh);
});

test("subagent calls are skipped", () => {
  const result = handleToolResult({ tool: "TaskCreate", input: {} }, null, true);
  assert.equal(result, undefined);
});

test("unrelated tool with no flag returns undefined", () => {
  const result = handleToolResult({ tool: "Read", input: {} }, null);
  assert.equal(result, undefined);
});

test("unrelated tool with manifest-emitted returns undefined", () => {
  const result = handleToolResult({ tool: "Read", input: {} }, "manifest-emitted");
  assert.equal(result, undefined);
});

test("TaskUpdate with null flag triggers refresh", () => {
  const result = handleToolResult({ tool: "TaskUpdate", input: {} }, null);
  assert.ok(result.refresh);
});

test("Edit tool does not trigger refresh without pending flag", () => {
  const result = handleToolResult({ tool: "Edit", input: {} }, null);
  assert.equal(result, undefined);
});
