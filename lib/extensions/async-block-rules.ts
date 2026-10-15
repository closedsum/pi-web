import { prefetchGitFacts } from "../git-query";
import { evaluateBlockRules, type BlockRule } from "./tool-blockers";
import {
  evaluateBlockRulesInstrumented,
  type TelemetryCollector,
} from "./telemetry-collector";
import type { BlockResult, BlockRuleContext } from "./types";

export interface AsyncRulePolicy {
  timeoutMs: number;
  failMode: "closed" | "open";
}

export const DEFAULT_POLICY: AsyncRulePolicy = {
  timeoutMs: 5_000,
  failMode: "closed",
};

export async function evaluateBlockRulesAsync(
  toolName: string,
  input: Record<string, unknown>,
  rules: readonly BlockRule[],
  ctx: BlockRuleContext | undefined,
  options?: {
    policy?: AsyncRulePolicy;
    collector?: TelemetryCollector;
    signal?: AbortSignal;
  },
): Promise<BlockResult | undefined> {
  if (!ctx?.cwd) {
    return options?.collector
      ? evaluateBlockRulesInstrumented(toolName, input, rules, ctx, options.collector)
      : evaluateBlockRules(toolName, input, rules, ctx);
  }

  const policy = options?.policy ?? DEFAULT_POLICY;

  const ac = new AbortController();
  if (options?.signal) {
    if (options.signal.aborted) {
      if (policy.failMode === "open") return undefined;
      const asyncCtx = { ...ctx, gitFacts: { latestInScope: null, toplevel: null } };
      return options?.collector
        ? evaluateBlockRulesInstrumented(toolName, input, rules, asyncCtx, options.collector)
        : evaluateBlockRules(toolName, input, rules, asyncCtx);
    }
    options.signal.addEventListener("abort", () => ac.abort(), { once: true });
  }

  let gitFacts: { latestInScope: string | null; toplevel: string | null };
  const timer = setTimeout(() => ac.abort(), policy.timeoutMs);

  try {
    gitFacts = await prefetchGitFacts(ctx.cwd, "master", [], {
      signal: ac.signal,
      timeoutMs: policy.timeoutMs,
    });
  } catch {
    if (policy.failMode === "open") {
      clearTimeout(timer);
      return undefined;
    }
    gitFacts = { latestInScope: null, toplevel: null };
  } finally {
    clearTimeout(timer);
  }

  const asyncCtx: BlockRuleContext = { ...ctx, gitFacts };

  return options?.collector
    ? evaluateBlockRulesInstrumented(toolName, input, rules, asyncCtx, options.collector)
    : evaluateBlockRules(toolName, input, rules, asyncCtx);
}
