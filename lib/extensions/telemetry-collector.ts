import type { BlockResult, BlockRuleContext } from "./types";
import { evaluateBlockRules, type BlockRule } from "./tool-blockers";

interface RuleStats {
  name: string;
  invocations: number;
  blocks: number;
  allows: number;
  totalMs: number;
  maxMs: number;
}

export interface TelemetrySnapshot {
  sessionId: string;
  capturedAt: string;
  rules: Record<string, RuleStats>;
  totalEvaluations: number;
  totalBlocks: number;
  totalAllows: number;
}

export class TelemetryCollector {
  private sessionId: string;
  private rules = new Map<string, RuleStats>();
  private totalEvaluations = 0;
  private totalBlocks = 0;
  private totalAllows = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  record(name: string, durationMs: number, blocked: boolean): void {
    let stats = this.rules.get(name);
    if (!stats) {
      stats = { name, invocations: 0, blocks: 0, allows: 0, totalMs: 0, maxMs: 0 };
      this.rules.set(name, stats);
    }
    stats.invocations++;
    stats.totalMs += durationMs;
    if (durationMs > stats.maxMs) stats.maxMs = durationMs;
    if (blocked) {
      stats.blocks++;
      this.totalBlocks++;
    } else {
      stats.allows++;
      this.totalAllows++;
    }
    this.totalEvaluations++;
  }

  snapshot(): TelemetrySnapshot {
    const rulesObj: Record<string, RuleStats> = {};
    for (const [key, stats] of this.rules) {
      rulesObj[key] = { ...stats };
    }
    return Object.freeze({
      sessionId: this.sessionId,
      capturedAt: new Date().toISOString(),
      rules: rulesObj,
      totalEvaluations: this.totalEvaluations,
      totalBlocks: this.totalBlocks,
      totalAllows: this.totalAllows,
    });
  }
}

export function instrumentRules(
  rules: readonly BlockRule[],
  collector: TelemetryCollector,
): BlockRule[] {
  return rules.map((rule) => ({
    name: rule.name,
    test(
      toolName: string,
      input: Record<string, unknown>,
      ctx?: BlockRuleContext,
    ): BlockResult | undefined {
      const start = performance.now();
      const result = rule.test(toolName, input, ctx);
      const ms = performance.now() - start;
      collector.record(rule.name, ms, !!result?.block);
      return result;
    },
  }));
}

export function evaluateBlockRulesInstrumented(
  toolName: string,
  input: Record<string, unknown>,
  rules: readonly BlockRule[],
  ctx: BlockRuleContext | undefined,
  collector: TelemetryCollector,
): BlockResult | undefined {
  try {
    return evaluateBlockRules(
      toolName,
      input,
      instrumentRules(rules, collector),
      ctx,
    );
  } catch {
    return evaluateBlockRules(toolName, input, rules, ctx);
  }
}
