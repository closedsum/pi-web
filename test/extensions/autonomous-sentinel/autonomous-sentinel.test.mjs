import assert from "node:assert/strict";
import test from "node:test";

function handleToolResult(event) {
  if (event.agent_id || event.agent_type) return undefined;
  const tool = event.tool || "";
  if (tool === "TaskUpdate") {
    const status = event.input?.status;
    if (status !== "completed") return undefined;
  } else if (tool === "TaskList") {
    // always fire on TaskList
  } else {
    return undefined;
  }
  return {
    inject: "[AUTONOMOUS-SENTINEL] Task completed. Check TaskList for remaining pending tasks. If ANY tasks remain pending, continue working on the next one immediately — do NOT stop to summarize or report progress. Only stop when zero tasks remain.",
  };
}

test("injects continue directive on TaskUpdate completed", () => {
  const event = { tool: "TaskUpdate", input: { taskId: "1", status: "completed" } };
  const result = handleToolResult(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /AUTONOMOUS-SENTINEL/);
});

test("does not inject on TaskUpdate in_progress", () => {
  const event = { tool: "TaskUpdate", input: { taskId: "1", status: "in_progress" } };
  assert.equal(handleToolResult(event), undefined);
});

test("injects on TaskList (always)", () => {
  const event = { tool: "TaskList" };
  const result = handleToolResult(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /AUTONOMOUS-SENTINEL/);
});

test("does not inject for subagents (has agent_id)", () => {
  const event = { tool: "TaskUpdate", input: { status: "completed" }, agent_id: "fork-123" };
  assert.equal(handleToolResult(event), undefined);
});

test("does not inject for subagents (has agent_type)", () => {
  const event = { tool: "TaskList", agent_type: "fork" };
  assert.equal(handleToolResult(event), undefined);
});

test("does not inject on unrelated tools", () => {
  const event = { tool: "Bash", output: "done" };
  assert.equal(handleToolResult(event), undefined);
});
