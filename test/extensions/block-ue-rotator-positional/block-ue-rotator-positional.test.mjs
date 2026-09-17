import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const ROTATOR_RE = /unreal\.Rotator\(/g;
const KEYWORD_ONLY = /^\s*(?:pitch|yaw|roll)\s*=/;

function hasPositionalRotator(cmd) {
  ROTATOR_RE.lastIndex = 0;
  let m;
  while ((m = ROTATOR_RE.exec(cmd)) !== null) {
    const after = cmd.slice(m.index + m[0].length);
    const paren = after.indexOf(")");
    if (paren < 0) continue;
    const args = after.slice(0, paren).split(",").map(s => s.trim());
    if (args.some(a => a && !KEYWORD_ONLY.test(a))) return true;
  }
  return false;
}

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (!hasPositionalRotator(cmd)) return undefined;
  return { block: true, reason: "BLOCKED: unreal.Rotator() with positional args. Use keyword args: unreal.Rotator(pitch=X, yaw=Y, roll=Z)" };
}

test("blocks positional Rotator args", () => {
  assertBlocked(handleToolCall(makePowerShellToolCallEvent('python -c "r = unreal.Rotator(-90, 0, 0)"')));
});

test("allows keyword Rotator args", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent('python -c "r = unreal.Rotator(pitch=-90, yaw=0, roll=0)"')));
});

test("allows no Rotator", () => {
  assertPassed(handleToolCall(makePowerShellToolCallEvent("python script.py")));
});
