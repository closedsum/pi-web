import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const GIT_PUSH_RE = /\bgit(?:\.exe)?\s+(?:-[Cc]\s+\S+\s+)*push(?=[\s;|&)<>]|$)/im;

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  if (!event.agent_id && !event.agent_type) return undefined;
  const cmd = event.input?.command || "";
  if (!GIT_PUSH_RE.test(cmd)) return undefined;
  return { block: true, reason: "[BLOCK-FORK-PUSH] BLOCKED: git push from a subagent session. Only the orchestrator may push." };
}

test("blocks git push from subagent", () => {
  const event = { ...makeBashToolCallEvent("git push"), agent_id: "fork-1" };
  assertBlocked(handleToolCall(event), /BLOCK-FORK-PUSH/);
});

test("blocks git push origin main from subagent", () => {
  const event = { ...makeBashToolCallEvent("git push origin main"), agent_type: "fork" };
  assertBlocked(handleToolCall(event), /BLOCK-FORK-PUSH/);
});

test("allows git push from main session (no agent_id)", () => {
  const event = makeBashToolCallEvent("git push");
  assertPassed(handleToolCall(event));
});

test("allows non-push git commands from subagent", () => {
  const event = { ...makeBashToolCallEvent("git status"), agent_id: "fork-1" };
  assertPassed(handleToolCall(event));
});

test("allows git commit from subagent", () => {
  const event = { ...makeBashToolCallEvent('git commit -m "fix"'), agent_id: "fork-1" };
  assertPassed(handleToolCall(event));
});
