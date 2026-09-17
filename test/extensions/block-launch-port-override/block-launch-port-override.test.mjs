import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (/ue-launch-csmcp/i.test(cmd) && /--port\b/i.test(cmd)) {
    return { block: true, reason: "BLOCKED: Do not pass --port to ue-launch-csmcp.py. The script auto-detects the CsMCP port." };
  }
  return undefined;
}

test("blocks --port on ue-launch-csmcp", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent("python ue-launch-csmcp.py Cropout.uproject --port 8094")));
});

test("allows ue-launch-csmcp without --port", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent("python ue-launch-csmcp.py Cropout.uproject")));
});

test("allows --port on other scripts", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent("python some-server.py --port 3000")));
});
