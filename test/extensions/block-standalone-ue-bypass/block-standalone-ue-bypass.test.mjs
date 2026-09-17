import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const STANDALONE_TO_VERB = {
  "ue-launch-csmcp.py": "launch",
  "ue-start-pie.py": "start-pie",
  "ue_cleanup.py": "cleanup",
  "ue_editor_registry.py": "editors",
};

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (/^\s*git\s/i.test(cmd)) return undefined;
  for (const [script, verb] of Object.entries(STANDALONE_TO_VERB)) {
    if (new RegExp(`\\b${script.replace(/\./g, "\\.")}\\b`, "i").test(cmd)) {
      return { block: true, reason: `BLOCKED: Direct call to ${script}. Use ue_action.py ${verb} instead.` };
    }
  }
  return undefined;
}

test("blocks direct ue-launch-csmcp.py", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent("python ue-launch-csmcp.py Cropout.uproject")), /ue_action\.py launch/);
});

test("blocks direct ue_cleanup.py", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent("python ue_cleanup.py")), /ue_action\.py cleanup/);
});

test("blocks direct ue-start-pie.py", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent("python ue-start-pie.py NEW_EDITOR_WINDOW")), /start-pie/);
});

test("allows ue_action.py (the correct path)", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent("python ue_action.py launch Cropout.uproject")));
});

test("allows git commit mentioning scripts", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('git commit -m "fix ue-launch-csmcp.py"')));
});
