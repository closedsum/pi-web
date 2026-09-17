import assert from "node:assert/strict";
import test from "node:test";
import { makeAgentToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const SCOPE_RE = /^##\s*Scope\s*$/m;
const KIND_RE = /^\s*KIND:\s*\S+/m;
const IN_RE = /^\s*IN:\s*.+/m;
const OUT_RE = /^\s*OUT:\s*.+/m;

function handleToolCall(event) {
  if (event.tool !== "Agent") return undefined;
  const subagentType = event.input?.subagent_type || "";
  if (subagentType !== "fork") return undefined;

  const prompt = event.input?.prompt || "";
  if (!SCOPE_RE.test(prompt)) {
    return { block: true, reason: "[FORK-SCOPE] BLOCKED: Missing ## Scope block in fork prompt." };
  }
  if (!KIND_RE.test(prompt)) {
    return { block: true, reason: "[FORK-SCOPE] BLOCKED: Missing KIND declaration in ## Scope block." };
  }
  if (!IN_RE.test(prompt)) {
    return { block: true, reason: "[FORK-SCOPE] BLOCKED: Missing IN declaration in ## Scope block." };
  }
  if (!OUT_RE.test(prompt)) {
    return { block: true, reason: "[FORK-SCOPE] BLOCKED: Missing OUT declaration in ## Scope block." };
  }
  return undefined;
}

test("allows fork with complete scope (KIND, IN, OUT)", () => {
  const prompt = "Do work\n\n## Scope\nKIND: code-lookup\nIN: find files\nOUT: no changes";
  assertPassed(handleToolCall(makeAgentToolCallEvent(prompt)));
});

test("blocks fork missing ## Scope entirely", () => {
  assertBlocked(handleToolCall(makeAgentToolCallEvent("Just do stuff")), /Missing ## Scope/);
});

test("blocks fork missing KIND", () => {
  const prompt = "Task\n\n## Scope\nIN: do thing\nOUT: nothing";
  assertBlocked(handleToolCall(makeAgentToolCallEvent(prompt)), /Missing KIND/);
});

test("blocks fork missing IN", () => {
  const prompt = "Task\n\n## Scope\nKIND: code-lookup\nOUT: nothing";
  assertBlocked(handleToolCall(makeAgentToolCallEvent(prompt)), /Missing IN/);
});

test("blocks fork missing OUT", () => {
  const prompt = "Task\n\n## Scope\nKIND: code-lookup\nIN: find X";
  assertBlocked(handleToolCall(makeAgentToolCallEvent(prompt)), /Missing OUT/);
});

test("ignores non-fork agent types", () => {
  assertPassed(handleToolCall(makeAgentToolCallEvent("No scope", "general-purpose")));
});

test("ignores non-Agent tools", () => {
  assertPassed(handleToolCall({ tool: "Bash", input: {} }));
});
