import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent, makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  const BROAD = [/stop-process\s+.*-name\s+.*unreal/i, /taskkill\s+.*\/im\s+.*unreal/i, /get-process\s+.*unreal.*\|\s*stop/i];
  const PID = [/taskkill\s+.*\/pid\s/i, /stop-process\s+.*-id\s/i];
  if (!BROAD.some(p => p.test(cmd))) return undefined;
  if (PID.some(p => p.test(cmd))) return undefined;
  return { block: true, reason: "BLOCKED: Broad UE process kill by name. Use PID-specific termination: taskkill /PID <pid> /F /T" };
}

test("blocks Stop-Process -Name UnrealEditor", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('Stop-Process -Name UnrealEditor -Force')));
});

test("blocks Get-Process | Stop-Process pipe", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('Get-Process UnrealEditor | Stop-Process -Force')));
});

test("allows PID-specific taskkill", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('taskkill /PID 1234 /F /T')));
});

test("allows non-UE process kills", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('Stop-Process -Name notepad')));
});
