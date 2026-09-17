import assert from "node:assert/strict";
import test from "node:test";
import { makeAgentToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event, state = {}) {
  if (event.agent_id || event.agent_type) return undefined;
  if (event.tool !== "Agent") return undefined;
  if (!state.dispatchPending) return undefined;
  return {
    block: true,
    reason: "[PARALLEL-DISPATCH-BLOCKED] Tasks were created but /gsd:parallel-tasks has not been invoked yet. Compute the independent frontier before dispatching.",
  };
}

test("blocks Agent dispatch when parallel tasks flag is set", () => {
  const event = makeAgentToolCallEvent("Do work\n\n## Scope\nKIND: code-lookup\nIN: x\nOUT: y");
  assertBlocked(handleToolCall(event, { dispatchPending: true }), /PARALLEL-DISPATCH-BLOCKED/);
});

test("allows Agent dispatch when flag is not set", () => {
  const event = makeAgentToolCallEvent("Do work\n\n## Scope\nKIND: code-lookup\nIN: x\nOUT: y");
  assertPassed(handleToolCall(event, { dispatchPending: false }));
});

test("allows Agent dispatch from subagent (has agent_id)", () => {
  const event = { ...makeAgentToolCallEvent("Work"), agent_id: "fork-1" };
  assertPassed(handleToolCall(event, { dispatchPending: true }));
});

test("allows non-Agent tools when flag is set", () => {
  const event = { tool: "Bash", input: { command: "git status" } };
  assertPassed(handleToolCall(event, { dispatchPending: true }));
});
