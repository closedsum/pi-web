import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

const KILL_ZERO_RE = /\bkill\s+(?:-0|-s\s*0)\b/i;

function handleToolCall(event) {
  if (event.tool !== "Monitor") return undefined;
  const cmd = event.input?.command || "";
  if (!KILL_ZERO_RE.test(cmd)) return undefined;
  return { block: true, reason: "[BLOCK-MONITOR-KILL-SIGNAL] kill -0 does not reliably detect Windows-native PIDs in Git Bash." };
}

test("blocks kill -0 in Monitor commands", () => {
  assertBlocked(handleToolCall({ tool: "Monitor", input: { command: 'while kill -0 $pid; do sleep 2; done' } }), /kill -0/);
});

test("blocks kill -s 0 in Monitor commands", () => {
  assertBlocked(handleToolCall({ tool: "Monitor", input: { command: 'kill -s 0 1234 && echo alive' } }), /BLOCK-MONITOR/);
});

test("allows Monitor without kill -0", () => {
  assertPassed(handleToolCall({ tool: "Monitor", input: { command: 'tail -f output.log' } }));
});

test("allows kill -0 in non-Monitor tools", () => {
  assertPassed(handleToolCall({ tool: "Bash", input: { command: "kill -0 1234" } }));
});
