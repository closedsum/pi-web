import assert from "node:assert/strict";
import test from "node:test";
import { makeAgentToolCallEvent } from "../_config.mjs";

const CLAUDE_MODEL_RE = /(?<![\w-])claude-(?:opus-(?:5|4-6)|sonnet-5)(?:\[1m\])?(?![\w-]|\[)/g;

function handleToolCall(event) {
  if (event.tool !== "Agent") return undefined;
  if (event.input?.subagent_type !== "fork") return undefined;
  const prompt = event.input?.prompt || "";
  const models = [...new Set(prompt.match(CLAUDE_MODEL_RE) || [])];
  if (!models.length) return undefined;
  return {
    inject: `[CLAUDE-MODEL-LANE] Forks inherit the session model; naming ${models.join(", ")} in the prompt cannot select it. Use gsd_impl_lane.py --provider claude instead.`,
  };
}

test("warns when fork prompt mentions claude-opus-5", () => {
  const event = makeAgentToolCallEvent("Use claude-opus-5 for this\n\n## Scope\nKIND: code-lookup\nIN: x\nOUT: y");
  const result = handleToolCall(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /CLAUDE-MODEL-LANE/);
  assert.match(result.inject, /claude-opus-5/);
});

test("warns when fork prompt mentions claude-sonnet-5", () => {
  const event = makeAgentToolCallEvent("Ask claude-sonnet-5\n\n## Scope\nKIND: code-lookup\nIN: x\nOUT: y");
  const result = handleToolCall(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /claude-sonnet-5/);
});

test("does not warn when no Claude model mentioned", () => {
  const event = makeAgentToolCallEvent("Check files\n\n## Scope\nKIND: code-lookup\nIN: x\nOUT: y");
  assert.equal(handleToolCall(event), undefined);
});

test("ignores non-fork agents", () => {
  const event = makeAgentToolCallEvent("Use claude-opus-5", "general-purpose");
  assert.equal(handleToolCall(event), undefined);
});

test("deduplicates multiple mentions of same model", () => {
  const event = makeAgentToolCallEvent("Use claude-opus-5 and claude-opus-5 again\n\n## Scope\nKIND: code-lookup\nIN: x\nOUT: y");
  const result = handleToolCall(event);
  const count = (result.inject.match(/claude-opus-5/g) || []).length;
  assert.equal(count, 1);
});
