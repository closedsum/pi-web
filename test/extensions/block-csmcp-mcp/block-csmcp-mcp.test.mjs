import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (!event.tool?.startsWith("mcp__csmcp__")) return undefined;
  return { block: true, reason: `BLOCKED: Direct MCP tool '${event.tool}' bypasses the UE dispatch chain. Use ue_action.py instead.` };
}

test("blocks mcp__csmcp__ tool calls", () => {
  assertBlocked(handleToolCall({ tool: "mcp__csmcp__console_exec" }), /dispatch chain/);
});

test("blocks mcp__csmcp__catalog", () => {
  assertBlocked(handleToolCall({ tool: "mcp__csmcp__catalog" }), /BLOCKED/);
});

test("allows non-csmcp tools", () => {
  assertPassed(handleToolCall({ tool: "Bash" }));
  assertPassed(handleToolCall({ tool: "mcp__other__tool" }));
});
