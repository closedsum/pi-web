import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const ALLOWED_GIT = new Set(["status", "log", "diff", "branch", "stash"]);

function handleToolCall(event) {
  if (event.agent_id || event.agent_type) return undefined;
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  const gitMatch = /^\s*git\s+(\S+)/.exec(cmd);
  if (gitMatch && ALLOWED_GIT.has(gitMatch[1])) return undefined;
  if (/gsd_impl_lane\.py\s+(?:queue|build-queue|pipeline|status)\b/i.test(cmd)) return undefined;
  if (/deploy\.py\s+--status\b/i.test(cmd)) return undefined;
  if (/^\s*(?:cat|head|tail|type)\s/i.test(cmd)) return undefined;
  if (/^\s*(?:Get-Process|tasklist)\b/i.test(cmd)) return undefined;
  return { block: true, reason: "[ORCHESTRATOR-ALLOWLIST] Orchestrator cannot run this command inline. Dispatch via lane or fork." };
}

test("allows git status from orchestrator", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git status")));
});

test("allows git log from orchestrator", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git log --oneline -5")));
});

test("blocks pytest from orchestrator", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent("pytest tests/")), /ORCHESTRATOR-ALLOWLIST/);
});

test("blocks npm test from orchestrator", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent("npm test")), /ORCHESTRATOR-ALLOWLIST/);
});

test("allows lane dispatch from orchestrator", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("python gsd_impl_lane.py queue --params-file spec.json")));
});

test("allows everything from subagents", () => {
  const event = { ...makeBashToolCallEvent("pytest tests/"), agent_id: "fork-1" };
  assertPassed(handleToolCall(event));
});

test("allows cat/head/tail reads", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("cat README.md")));
});

test("allows deploy.py --status", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("python deploy.py --status")));
});
