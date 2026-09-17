import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "SendFeedback") return undefined;
  return { block: true, reason: "[BLOCK-SEND-FEEDBACK] BLOCKED: feedback drafts are disabled; record the gap in your report / task board instead." };
}

test("blocks SendFeedback tool", () => {
  assertBlocked(handleToolCall({ tool: "SendFeedback", input: { title: "bug" } }), /BLOCK-SEND-FEEDBACK/);
});

test("allows other tools", () => {
  assertPassed(handleToolCall({ tool: "Bash", input: {} }));
  assertPassed(handleToolCall({ tool: "Edit", input: {} }));
  assertPassed(handleToolCall({ tool: "TaskCreate", input: {} }));
});
