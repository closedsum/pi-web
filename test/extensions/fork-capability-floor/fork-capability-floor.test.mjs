import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makeAgentToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const ORCHESTRATOR_ONLY_TOOLS = new Set(["TaskCreate", "TaskUpdate", "Agent"]);
const ORCHESTRATOR_ONLY_COMMANDS = [
  /\bgit\s+(?:merge|rebase|checkout|switch|reset|cherry-pick)\b/i,
  /\bgsd_impl_lane\.py\s+(?:pipeline|build-queue|queue|run)\b/i,
  /\bgsd-review\.py\s+invoke-all\b/i,
];

function handleToolCall(event) {
  if (!event.agent_id && !event.agent_type) return undefined;
  if (ORCHESTRATOR_ONLY_TOOLS.has(event.tool)) {
    return { block: true, reason: `fork-capability-floor: ${event.tool} is orchestrator-only` };
  }
  if (event.tool === "Bash" || event.tool === "PowerShell") {
    const cmd = event.input?.command || "";
    for (const re of ORCHESTRATOR_ONLY_COMMANDS) {
      if (re.test(cmd)) return { block: true, reason: "fork-capability-floor: command is orchestrator-only" };
    }
  }
  return undefined;
}

test("blocks TaskCreate from subagent", () => {
  assertBlocked(handleToolCall({ tool: "TaskCreate", input: {}, agent_id: "fork-1" }), /orchestrator-only/);
});

test("blocks TaskUpdate from subagent", () => {
  assertBlocked(handleToolCall({ tool: "TaskUpdate", input: {}, agent_type: "fork" }), /orchestrator-only/);
});

test("blocks nested Agent from subagent", () => {
  assertBlocked(handleToolCall({ ...makeAgentToolCallEvent("nest"), agent_id: "fork-1" }), /orchestrator-only/);
});

test("blocks git merge from subagent", () => {
  assertBlocked(handleToolCall({ ...makeBashToolCallEvent("git merge feature"), agent_id: "fork-1" }), /orchestrator-only/);
});

test("blocks git rebase from subagent", () => {
  assertBlocked(handleToolCall({ ...makeBashToolCallEvent("git rebase main"), agent_id: "fork-1" }), /orchestrator-only/);
});

test("allows git status from subagent", () => {
  assertPassed(handleToolCall({ ...makeBashToolCallEvent("git status"), agent_id: "fork-1" }));
});

test("allows TaskCreate from main session", () => {
  assertPassed(handleToolCall({ tool: "TaskCreate", input: {} }));
});

test("allows Read from subagent", () => {
  assertPassed(handleToolCall({ tool: "Read", input: {}, agent_id: "fork-1" }));
});
