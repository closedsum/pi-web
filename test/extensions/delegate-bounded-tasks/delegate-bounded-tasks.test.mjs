import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makeReadToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const MAX_INLINE_LINES = 200;
const BOUNDED_PATTERNS = [/gsd-review\.py/i, /gsd-config\.py/i, /gsd-cross-research\.py/i, /ue_action\.py/i];

function handleToolCall(event) {
  if (event.agent_id || event.agent_type) return undefined;
  if (event.tool === "Read") {
    const limit = event.input?.limit;
    if (limit && limit <= MAX_INLINE_LINES) return undefined;
    return { block: true, reason: `[DELEGATE-BOUNDED-TASKS] BLOCKED: unbounded Read. Pass offset + limit (limit <= ${MAX_INLINE_LINES}).` };
  }
  if (event.tool === "Bash" || event.tool === "PowerShell") {
    const cmd = event.input?.command || "";
    for (const p of BOUNDED_PATTERNS) {
      if (p.test(cmd)) {
        return { block: true, reason: `[DELEGATE-BOUNDED-TASKS] BLOCKED: command matches bounded-task pattern. Delegate to a subagent.` };
      }
    }
  }
  return undefined;
}

test("blocks unbounded Read from orchestrator", () => {
  const event = { tool: "Read", input: { file_path: "big-file.ts" } };
  assertBlocked(handleToolCall(event), /DELEGATE-BOUNDED-TASKS/);
});

test("allows bounded Read with limit", () => {
  const event = { tool: "Read", input: { file_path: "big-file.ts", limit: 100 } };
  assertPassed(handleToolCall(event));
});

test("blocks gsd-review.py from orchestrator", () => {
  const event = makeBashToolCallEvent('python gsd-review.py invoke-all --wait');
  assertBlocked(handleToolCall(event), /bounded-task/);
});

test("blocks gsd-config.py from orchestrator", () => {
  const event = makeBashToolCallEvent('python gsd-config.py get review.enabled');
  assertBlocked(handleToolCall(event), /bounded-task/);
});

test("allows gsd-review.py from subagent", () => {
  const event = { ...makeBashToolCallEvent('python gsd-review.py invoke-all'), agent_id: "fork-1" };
  assertPassed(handleToolCall(event));
});

test("allows regular Bash commands", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git status")));
});
