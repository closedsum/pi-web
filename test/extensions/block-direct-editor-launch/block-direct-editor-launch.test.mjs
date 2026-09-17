import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  const hasUe = /UnrealEditor(?:-Cmd)?(?:\.exe)?/i.test(cmd);
  const hasProject = /\.uproject/i.test(cmd);
  const hasStartProcess = /\bStart-Process\b[^;|&]*UnrealEditor/i.test(cmd);
  if ((hasUe && hasProject) || hasStartProcess) {
    return { block: true, reason: "BLOCKED: Direct UnrealEditor launch. Use ue-launch-csmcp.py instead." };
  }
  return undefined;
}

test("blocks direct UnrealEditor launch", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent('UnrealEditor-Cmd.exe Cropout.uproject')));
});

test("blocks Start-Process UnrealEditor", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('Start-Process UnrealEditor -ArgumentList "Project.uproject"')));
});

test("allows ue-launch-csmcp.py", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("python ue-launch-csmcp.py Cropout.uproject")));
});

test("allows non-UE commands", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git status")));
});
