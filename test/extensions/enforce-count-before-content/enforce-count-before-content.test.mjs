import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

const GREP_HEAD_LIMIT_MAX = 100;

function handleToolCall(event) {
  if (event.tool === "Grep") {
    const mode = event.input?.output_mode || "files_with_matches";
    if (mode !== "content") return undefined;
    const limit = event.input?.head_limit;
    if (typeof limit === "number" && limit <= GREP_HEAD_LIMIT_MAX) return undefined;
    return { block: true, reason: `BLOCKED: Grep with output_mode 'content' requires head_limit <= ${GREP_HEAD_LIMIT_MAX}. Use 'count' or 'files_with_matches' first.` };
  }
  return undefined;
}

test("blocks Grep content mode without head_limit", () => {
  const event = { tool: "Grep", input: { pattern: "foo", output_mode: "content" } };
  assertBlocked(handleToolCall(event), /head_limit/);
});

test("blocks Grep content mode with head_limit > 100", () => {
  const event = { tool: "Grep", input: { pattern: "foo", output_mode: "content", head_limit: 200 } };
  assertBlocked(handleToolCall(event), /head_limit/);
});

test("allows Grep content mode with head_limit <= 100", () => {
  const event = { tool: "Grep", input: { pattern: "foo", output_mode: "content", head_limit: 50 } };
  assertPassed(handleToolCall(event));
});

test("allows Grep files_with_matches mode (default)", () => {
  const event = { tool: "Grep", input: { pattern: "foo" } };
  assertPassed(handleToolCall(event));
});

test("allows Grep count mode", () => {
  const event = { tool: "Grep", input: { pattern: "foo", output_mode: "count" } };
  assertPassed(handleToolCall(event));
});

test("allows non-Grep tools", () => {
  assertPassed(handleToolCall({ tool: "Read", input: {} }));
});
