import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

function handleToolCall(event, state = {}) {
  if (!EDIT_TOOLS.has(event.tool)) return undefined;
  if ((state.consecutiveFailures || 0) < 2) return undefined;
  if (state.researchDone) return undefined;
  return {
    block: true,
    reason: `BLOCKED: ${state.consecutiveFailures} consecutive build failures. Run /gsd:find-unknowns then /gsd:cross-research before editing. Gate resets when research completes or a build succeeds.`,
  };
}

test("blocks Edit after 2+ consecutive build failures", () => {
  const event = { tool: "Edit", input: {} };
  assertBlocked(handleToolCall(event, { consecutiveFailures: 3 }), /consecutive build failures/);
});

test("blocks Write after 2 failures", () => {
  const event = { tool: "Write", input: {} };
  assertBlocked(handleToolCall(event, { consecutiveFailures: 2 }), /BLOCKED/);
});

test("allows Edit after research is done", () => {
  const event = { tool: "Edit", input: {} };
  assertPassed(handleToolCall(event, { consecutiveFailures: 5, researchDone: true }));
});

test("allows Edit with fewer than 2 failures", () => {
  const event = { tool: "Edit", input: {} };
  assertPassed(handleToolCall(event, { consecutiveFailures: 1 }));
});

test("allows non-edit tools regardless of failure count", () => {
  const event = { tool: "Bash", input: {} };
  assertPassed(handleToolCall(event, { consecutiveFailures: 10 }));
});

test("allows Edit with no state (zero failures)", () => {
  assertPassed(handleToolCall({ tool: "Edit", input: {} }));
});
