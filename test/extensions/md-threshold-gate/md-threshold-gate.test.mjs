import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

const GLOBAL_THRESHOLD = 100;
const PROJECT_THRESHOLD = 150;

function handleToolCall(event, fileInfo = {}) {
  const tool = event.tool;
  if (!["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return undefined;
  const filePath = event.input?.file_path || "";
  if (!filePath.toLowerCase().endsWith(".md")) return undefined;
  if (/memory|\.planning/i.test(filePath)) return undefined;
  const lineCount = fileInfo.lineCount || 0;
  if (lineCount === 0) return undefined;
  const isGlobal = /[/\\]\.claude[/\\]|[/\\]gsd-config[/\\]/i.test(filePath);
  const threshold = isGlobal ? GLOBAL_THRESHOLD : PROJECT_THRESHOLD;
  if (lineCount < threshold) return undefined;
  const isNonGrowth = event.input?.old_string && event.input?.new_string &&
    event.input.new_string.split("\n").length <= event.input.old_string.split("\n").length;
  if (isNonGrowth) return undefined;
  return {
    block: true,
    reason: `BLOCKED: ${filePath.split(/[/\\]/).pop()} is at ${lineCount} lines (threshold: ${threshold} for ${isGlobal ? "global" : "project"} .md files).`,
  };
}

test("blocks Edit on global .md at threshold", () => {
  const event = { tool: "Edit", input: { file_path: "C:\\Users\\user\\.claude\\RULES.md", new_string: "new\nlines\n" } };
  assertBlocked(handleToolCall(event, { lineCount: 102 }), /102 lines/);
});

test("blocks Edit on project .md at threshold", () => {
  const event = { tool: "Edit", input: { file_path: "D:\\project\\CLAUDE.md", new_string: "more\n" } };
  assertBlocked(handleToolCall(event, { lineCount: 155 }), /155 lines/);
});

test("allows non-growth Edit (replacement)", () => {
  const event = { tool: "Edit", input: { file_path: "C:\\Users\\user\\.claude\\RULES.md", old_string: "old\nold2\n", new_string: "new\n" } };
  assertPassed(handleToolCall(event, { lineCount: 102 }));
});

test("allows .md under threshold", () => {
  const event = { tool: "Edit", input: { file_path: "C:\\Users\\user\\.claude\\RULES.md", new_string: "x\n" } };
  assertPassed(handleToolCall(event, { lineCount: 50 }));
});

test("skips memory files", () => {
  const event = { tool: "Write", input: { file_path: "C:\\Users\\user\\.claude\\memory\\note.md" } };
  assertPassed(handleToolCall(event, { lineCount: 200 }));
});

test("skips .planning files", () => {
  const event = { tool: "Write", input: { file_path: ".planning/PLAN.md" } };
  assertPassed(handleToolCall(event, { lineCount: 300 }));
});

test("skips non-.md files", () => {
  const event = { tool: "Edit", input: { file_path: "src/main.ts" } };
  assertPassed(handleToolCall(event, { lineCount: 500 }));
});
