/**
 * PostToolUse handlers for pi extensions.
 * Ports Claude Code PostToolUse hooks into pi's tool_result event.
 *
 * Each rule is a named function: (ev, state) => ResultAction | undefined.
 * State is per-session, owned by the extension factory, mutated in place.
 */
import type { ToolResultEvent, ResultAction, ResultRuleState } from "./types";

const commandStr = (input?: Record<string, unknown>): string =>
  typeof input?.command === "string" ? (input.command as string) : "";

export interface ResultRule {
  name: string;
  test: (ev: ToolResultEvent, state: ResultRuleState) => ResultAction | undefined;
}

export function createResultState(): ResultRuleState {
  return {
    lastCommitTime: 0,
    lastBuildTime: 0,
    commitCount: 0,
    linesSinceReview: 0,
  };
}

export const buildVerifyReminder: ResultRule = {
  name: "build-verify-reminder",
  test(ev, state) {
    if (ev.isError || (ev.exitCode !== undefined && ev.exitCode !== 0)) return;
    const cmd = commandStr(ev.input);
    if (/\bgit\b[^\n;|&]*\bcommit\b/i.test(cmd) && !/--amend\b/i.test(cmd)) {
      state.lastCommitTime = Date.now();
      state.commitCount++;
      return { context: "[BUILD-VERIFY] Commit recorded. Run build verification (test suite or build) before next commit." };
    }
    if (/\bue_action(?:\.py)?\s+build\b/i.test(cmd) || /\bnpm\s+(?:test|run\s+build)\b/i.test(cmd)) {
      state.lastBuildTime = Date.now();
    }
    if (state.lastCommitTime > 0 && state.lastBuildTime < state.lastCommitTime) {
      return { warn: `[BUILD-VERIFY] No build verification since last commit (last commit ${Math.round((Date.now() - state.lastCommitTime) / 60000)}m ago).` };
    }
    return undefined;
  },
};

export const reviewReminder: ResultRule = {
  name: "review-reminder",
  test(ev, state) {
    if (ev.toolName !== "Bash" && ev.toolName !== "PowerShell") return;
    const output = ev.output ?? "";
    const commitMatch = /\[[\w/.-]+\s+[0-9a-f]{7,}\]/.test(output);
    if (!commitMatch) return;
    const lineMatch = output.match(/(\d+) uncommitted lines/);
    if (lineMatch) {
      state.linesSinceReview = parseInt(lineMatch[1], 10);
    }
    if (state.linesSinceReview > 200) {
      return { context: `[REVIEW-REMINDER] Commit/push with ${state.linesSinceReview} uncommitted lines. Run /gsd:cross-review before committing.` };
    }
    return undefined;
  },
};

export const commitTracker: ResultRule = {
  name: "commit-tracker",
  test(ev, state) {
    if (ev.isError || (ev.exitCode !== undefined && ev.exitCode !== 0)) return;
    const cmd = commandStr(ev.input);
    if (/\bgit\b[^\n;|&]*\bcommit\b/i.test(cmd) && !/--amend\b/i.test(cmd)) {
      state.lastCommitTime = Date.now();
      state.commitCount++;
    }
    return undefined;
  },
};

export const ALL_RESULT_RULES: readonly ResultRule[] = [
  buildVerifyReminder,
  reviewReminder,
];

export function evaluateResultRules(
  ev: ToolResultEvent,
  state: ResultRuleState,
  rules: readonly ResultRule[] = ALL_RESULT_RULES,
): ResultAction | undefined {
  for (const rule of rules) {
    const result = rule.test(ev, state);
    if (result) return result;
  }
  return undefined;
}
