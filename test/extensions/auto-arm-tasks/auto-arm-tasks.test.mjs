import assert from "node:assert/strict";
import test from "node:test";

const TODO_PATTERN = /\.planning[/\\]todos[/\\]pending[/\\].+\.md$/i;
const BACKLOG_PATTERN = /\.planning[/\\]BACKLOG\.md$/i;

function handleToolResult(event) {
  const tool = event.tool || "";
  if (tool !== "Write" && tool !== "Edit") return undefined;
  const filePath = event.input?.file_path || "";
  if (TODO_PATTERN.test(filePath)) {
    const basename = filePath.split(/[/\\]/).pop();
    return { inject: `[AUTO-ARM] New todo created: ${basename}. Add it as a tracked task via TaskCreate.` };
  }
  if (BACKLOG_PATTERN.test(filePath)) {
    return { inject: "[AUTO-ARM] BACKLOG.md updated. Track relevant new items via TaskCreate." };
  }
  return undefined;
}

test("injects reminder when writing a new todo file", () => {
  const event = { tool: "Write", input: { file_path: ".planning/todos/pending/fix-auth.md" } };
  const result = handleToolResult(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /AUTO-ARM/);
  assert.match(result.inject, /fix-auth\.md/);
});

test("injects reminder when editing BACKLOG.md", () => {
  const event = { tool: "Edit", input: { file_path: ".planning/BACKLOG.md" } };
  const result = handleToolResult(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /AUTO-ARM/);
  assert.match(result.inject, /BACKLOG/);
});

test("ignores Write to unrelated files", () => {
  const event = { tool: "Write", input: { file_path: "src/main.ts" } };
  assert.equal(handleToolResult(event), undefined);
});

test("ignores non-Write/Edit tools", () => {
  const event = { tool: "Bash", input: { file_path: ".planning/todos/pending/x.md" } };
  assert.equal(handleToolResult(event), undefined);
});

test("handles Windows backslash paths", () => {
  const event = { tool: "Write", input: { file_path: ".planning\\todos\\pending\\new-task.md" } };
  const result = handleToolResult(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /new-task\.md/);
});
