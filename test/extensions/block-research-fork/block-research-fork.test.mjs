import assert from "node:assert/strict";
import test from "node:test";
import { makeAgentToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const VALID_KINDS = ["code-lookup", "cross-research", "cross-review", "data-recovery", "lane-ops", "research"];
const SCOPE_RE = /^##\s*Scope\s*$/m;
const KIND_RE = /^\s*KIND:\s*(\S+)/m;

function handleToolCall(event) {
  if (event.tool !== "Agent") return undefined;
  const subagentType = event.input?.subagent_type || "";
  if (subagentType !== "fork") return undefined;

  const prompt = event.input?.prompt || "";
  const scopeMatch = SCOPE_RE.test(prompt);
  if (!scopeMatch) {
    return { block: true, reason: "[FORK-KIND] BLOCKED: No ## Scope block found in fork prompt." };
  }

  const kindMatch = KIND_RE.exec(prompt);
  if (!kindMatch) {
    return { block: true, reason: "[FORK-KIND] BLOCKED: No KIND declaration found in ## Scope block." };
  }

  const kind = kindMatch[1].toLowerCase();
  if (!VALID_KINDS.includes(kind)) {
    return { block: true, reason: `[FORK-KIND] BLOCKED: Invalid fork scope: unknown KIND '${kind}'; expected one of <${VALID_KINDS.join("|")}>` };
  }

  if (kind === "research") {
    return { block: true, reason: "BLOCKED: KIND research must use /gsd:cross-research (multi-model), not a single-model fork." };
  }

  return undefined;
}

test("blocks fork with KIND: research", () => {
  const event = makeAgentToolCallEvent("Do research\n\n## Scope\nKIND: research\nIN: explore\nOUT: nothing");
  assertBlocked(handleToolCall(event), /cross-research/);
});

test("allows fork with KIND: code-lookup", () => {
  const event = makeAgentToolCallEvent("Find the file\n\n## Scope\nKIND: code-lookup\nIN: find X\nOUT: no changes");
  assertPassed(handleToolCall(event));
});

test("allows fork with KIND: cross-review", () => {
  const event = makeAgentToolCallEvent("Review code\n\n## Scope\nKIND: cross-review\nIN: review diff\nOUT: no changes");
  assertPassed(handleToolCall(event));
});

test("blocks fork with no ## Scope block", () => {
  const event = makeAgentToolCallEvent("Do something without scope");
  assertBlocked(handleToolCall(event), /No ## Scope block/);
});

test("blocks fork with invalid KIND", () => {
  const event = makeAgentToolCallEvent("Task\n\n## Scope\nKIND: investigation\nIN: check\nOUT: none");
  assertBlocked(handleToolCall(event), /unknown KIND/);
});

test("ignores non-fork agent types", () => {
  const event = makeAgentToolCallEvent("Do thing", "general-purpose");
  assertPassed(handleToolCall(event));
});

test("ignores non-Agent tools", () => {
  const event = { tool: "Bash", input: { command: "echo" } };
  assertPassed(handleToolCall(event));
});
