import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event, repoState = {}) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (!/\bgit\b[^\n;|&]*\bcommit\b/i.test(cmd)) return undefined;
  if (!repoState.hasStagedMd) return undefined;
  if (!repoState.hasDocChain) return undefined;
  if (!repoState.brokenLinks) return undefined;
  return {
    block: true,
    reason: `[MD-CHAIN-GATE] check_doc_chain.py found ${repoState.brokenLinks} broken link(s). Fix broken .md links before committing.`,
  };
}

test("blocks commit with broken doc chain links", () => {
  const event = makeBashToolCallEvent('git commit -m "fix"');
  assertBlocked(handleToolCall(event, { hasStagedMd: true, hasDocChain: true, brokenLinks: 5 }), /MD-CHAIN-GATE/);
});

test("passes when no staged .md files", () => {
  const event = makeBashToolCallEvent('git commit -m "fix"');
  assertPassed(handleToolCall(event, { hasStagedMd: false, hasDocChain: true, brokenLinks: 5 }));
});

test("passes when no doc chain exists", () => {
  const event = makeBashToolCallEvent('git commit -m "fix"');
  assertPassed(handleToolCall(event, { hasStagedMd: true, hasDocChain: false }));
});

test("passes when no broken links", () => {
  const event = makeBashToolCallEvent('git commit -m "fix"');
  assertPassed(handleToolCall(event, { hasStagedMd: true, hasDocChain: true, brokenLinks: 0 }));
});

test("ignores non-commit commands", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git status"), { hasStagedMd: true, hasDocChain: true, brokenLinks: 10 }));
});
