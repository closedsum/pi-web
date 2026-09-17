import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent, makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (!/\/csmcp\/console/i.test(cmd)) return undefined;
  if (/ue_action\.py/i.test(cmd) || /ue_csmcp_http/i.test(cmd) || /test_.*\.py/i.test(cmd)) return undefined;
  if (/Invoke-RestMethod|Invoke-WebRequest|curl\b/i.test(cmd)) {
    return { block: true, reason: "BLOCKED: Direct HTTP to /csmcp/console bypasses dispatch chain. Use ue_action.py instead." };
  }
  return undefined;
}

test("blocks curl to csmcp console", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent('curl http://localhost:8094/csmcp/console -d "py print(1)"')));
});

test("blocks Invoke-RestMethod to console", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('Invoke-RestMethod -Uri "http://localhost:8094/csmcp/console"')));
});

test("allows ue_action.py dispatch", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('python ue_action.py open-map TestMap')));
});

test("allows ue_csmcp_http.py", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('python ue_csmcp_http.py console "py print(1)"')));
});

test("allows test scripts", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('python test_console.py /csmcp/console')));
});
