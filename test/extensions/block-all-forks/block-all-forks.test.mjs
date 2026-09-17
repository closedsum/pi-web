import assert from "node:assert/strict";
import test from "node:test";
import { makeAgentToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const ALLOWED_KINDS_RE = /KIND:\s*(?:lane-ops|cross-review|cross-research|code-lookup|data-recovery)/i;

function handleToolCall(event) {
  if (event.tool !== "Agent") return undefined;
  const subagentType = event.input?.subagent_type || "";
  if (subagentType !== "fork") return undefined;
  const prompt = (event.input?.prompt || "").slice(0, 2000);
  if (ALLOWED_KINDS_RE.test(prompt)) return undefined;
  return {
    block: true,
    reason: "[FORK-BLOCKED] Forks are disabled for implementation work. Route impl through gsd_impl_lane.py lanes.",
  };
}

test("blocks fork without allowed KIND", () => {
  const event = makeAgentToolCallEvent("Implement feature X\n\n## Scope\nKIND: impl\nIN: write code\nOUT: nothing");
  assertBlocked(handleToolCall(event), /FORK-BLOCKED/);
});

test("allows fork with KIND: code-lookup", () => {
  const event = makeAgentToolCallEvent("Find file\n\n## Scope\nKIND: code-lookup\nIN: locate\nOUT: no edits");
  assertPassed(handleToolCall(event));
});

test("allows fork with KIND: cross-review", () => {
  const event = makeAgentToolCallEvent("Review\n\n## Scope\nKIND: cross-review\nIN: diff\nOUT: no edits");
  assertPassed(handleToolCall(event));
});

test("allows fork with KIND: lane-ops", () => {
  const event = makeAgentToolCallEvent("Dispatch\n\n## Scope\nKIND: lane-ops\nIN: run lane\nOUT: nothing");
  assertPassed(handleToolCall(event));
});

test("allows fork with KIND: data-recovery", () => {
  const event = makeAgentToolCallEvent("Recover\n\n## Scope\nKIND: data-recovery\nIN: salvage\nOUT: nothing");
  assertPassed(handleToolCall(event));
});

test("blocks fork with no scope at all", () => {
  const event = makeAgentToolCallEvent("Do something");
  assertBlocked(handleToolCall(event), /FORK-BLOCKED/);
});

test("ignores non-fork agents", () => {
  assertPassed(handleToolCall(makeAgentToolCallEvent("Thing", "general-purpose")));
});
