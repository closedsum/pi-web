import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (/^\s*git\s+.*\b(?:commit|tag)\b/i.test(cmd)) return undefined;
  if (/-{1,2}LiveCoding\b/i.test(cmd) || /LiveCoding\.Compile/i.test(cmd) || /LiveCoding.*bEnabled\s*=\s*True/i.test(cmd)) {
    return { block: true, reason: "BLOCKED: LiveCoding is permanently disabled per UE-RULES.md." };
  }
  return undefined;
}

test("blocks -LiveCoding flag", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('UnrealEditor -LiveCoding Project.uproject')));
});

test("blocks LiveCoding.Compile", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('LiveCoding.Compile -Full')));
});

test("blocks enabling LiveCoding", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('LiveCoding bEnabled=True')));
});

test("allows git commit mentioning LiveCoding", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('git commit -m "disable LiveCoding"')));
});

test("allows unrelated commands", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('python ue_action.py build')));
});
