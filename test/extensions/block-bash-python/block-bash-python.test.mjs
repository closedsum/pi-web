import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "Bash") return undefined;
  const cmd = event.input?.command || "";
  if (/\bpython[23]?\b/.test(cmd)) {
    return { block: true, reason: "Use PowerShell for Python commands on Windows (MSYS path mangling)" };
  }
  return undefined;
}

test("blocks python via Bash tool", () => {
  const event = makeBashToolCallEvent('python "C:\\script.py"');
  assertBlocked(handleToolCall(event), /PowerShell/);
});

test("blocks python3 via Bash tool", () => {
  const event = makeBashToolCallEvent("python3 -c 'print(1)'");
  assertBlocked(handleToolCall(event), /PowerShell/);
});

test("allows non-python Bash commands", () => {
  const event = makeBashToolCallEvent("git status");
  assertPassed(handleToolCall(event));
});

test("allows grep mentioning python in content", () => {
  const event = makeBashToolCallEvent('grep "python" README.md');
  assertBlocked(handleToolCall(event), /PowerShell/);
});
