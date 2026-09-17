import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makePowerShellToolCallEvent, makeReadToolCallEvent } from "../_config.mjs";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const EXIT_CODE_RE = /^Exit code (\d+)\b/;
const ERROR_PATTERNS = [/error/i, /failed/i, /not found/i, /missing/i, /unparseable/i, /exception/i, /traceback/i];

function handleToolResult(event) {
  if (!SHELL_TOOLS.has(event.tool)) return undefined;
  const output = event.output || "";
  const exitMatch = EXIT_CODE_RE.exec(output);
  if (!exitMatch || exitMatch[1] === "0") return undefined;
  if (!ERROR_PATTERNS.some((p) => p.test(output))) return undefined;
  return {
    inject: `[GAP-TASKING] Command failed (exit ${exitMatch[1]}). If this reveals a gap, bug, or missing capability, file it NOW via TaskCreate or /gsd:add-todo.`,
  };
}

test("injects gap reminder on Bash exit 1 with error keyword", () => {
  const event = { tool: "Bash", output: "Exit code 1\nError: file not found" };
  const result = handleToolResult(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /GAP-TASKING/);
  assert.match(result.inject, /exit 1/);
});

test("injects gap reminder on PowerShell exit 2 with traceback", () => {
  const event = { tool: "PowerShell", output: "Exit code 2\nTraceback (most recent call last):" };
  const result = handleToolResult(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /exit 2/);
});

test("does not inject on exit 0", () => {
  const event = { tool: "Bash", output: "Exit code 0\nDone" };
  assert.equal(handleToolResult(event), undefined);
});

test("does not inject on success without exit code", () => {
  const event = { tool: "Bash", output: "All tests passed" };
  assert.equal(handleToolResult(event), undefined);
});

test("does not inject on non-shell tools", () => {
  const event = { tool: "Read", output: "Exit code 1\nError: missing" };
  assert.equal(handleToolResult(event), undefined);
});

test("does not inject on exit 1 without error keywords", () => {
  const event = { tool: "Bash", output: "Exit code 1\nNo changes detected" };
  assert.equal(handleToolResult(event), undefined);
});
