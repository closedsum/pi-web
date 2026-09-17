import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const BOUNDED_PATTERNS = [
  { re: /\bpython[0-9.]*(?:\.exe)?\b/i, name: "python" },
  { re: /\bpytest\b/i, name: "pytest" },
  { re: /\bnode\b.*\s--test\b/i, name: "node --test" },
  { re: /\bgsd-review\.py\b/i, name: "gsd-review.py" },
];

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  if (!event.agent_id && !event.agent_type) return undefined;
  if (!event.input?.run_in_background) return undefined;
  const cmd = event.input?.command || "";
  for (const p of BOUNDED_PATTERNS) {
    if (p.re.test(cmd)) {
      return { block: true, reason: `[BLOCK-FORK-BACKGROUND] BLOCKED: run_in_background for ${p.name} in subagent. Use foreground with explicit timeout.` };
    }
  }
  return undefined;
}

test("blocks background python in subagent", () => {
  const event = { ...makeBashToolCallEvent("python test.py"), agent_id: "fork-1", input: { command: "python test.py", run_in_background: true } };
  assertBlocked(handleToolCall(event), /BLOCK-FORK-BACKGROUND/);
});

test("blocks background node --test in subagent", () => {
  const event = { tool: "Bash", agent_type: "fork", input: { command: 'node --test "lib/*.test.mjs"', run_in_background: true } };
  assertBlocked(handleToolCall(event), /node --test/);
});

test("allows foreground python in subagent", () => {
  const event = { ...makeBashToolCallEvent("python test.py"), agent_id: "fork-1" };
  assertPassed(handleToolCall(event));
});

test("allows background in main session", () => {
  const event = { tool: "Bash", input: { command: "python test.py", run_in_background: true } };
  assertPassed(handleToolCall(event));
});

test("allows background non-bounded command in subagent", () => {
  const event = { tool: "Bash", agent_id: "fork-1", input: { command: "tail -f log.txt", run_in_background: true } };
  assertPassed(handleToolCall(event));
});
