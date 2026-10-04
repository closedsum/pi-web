/**
 * GSD Pi Extension — unified entry point.
 *
 * Combines modular extension handlers (tool blockers, session lifecycle, etc.)
 * into a single InlineExtension factory. Each module is scope-isolated with
 * its own state and shared utilities imported from sibling modules.
 *
 * Principles:
 * - Fail fast and loud: errors throw immediately, never swallowed
 * - Wall clock timing: every handler execution is timed
 * - Scope isolation: each module manages its own state
 * - No duplication: shared types from ./types, shared test harness
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { evaluateBlockRules, ALL_RULES, type BlockRule } from "./tool-blockers";
import type { ToolCallEvent, ExtensionTiming } from "./types";

export const GSD_EXTENSION_NAME = "pi-web-gsd-unified";

export interface GsdExtensionOptions {
  enableBlockRules?: boolean;
  blockRules?: readonly BlockRule[];
  onTiming?: (timing: ExtensionTiming) => void;
}

export function createGsdExtension(options: GsdExtensionOptions = {}): InlineExtension {
  const enableBlockRules = options.enableBlockRules ?? true;
  const rules = options.blockRules ?? ALL_RULES;
  const onTiming = options.onTiming;

  return {
    name: GSD_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      if (enableBlockRules) {
        pi.on("tool_call", (ev: ToolCallEvent) => {
          const start = performance.now();
          const result = evaluateBlockRules(ev.toolName, ev.input ?? {}, rules);
          const durationMs = performance.now() - start;

          if (onTiming) {
            onTiming({
              event: "tool_call",
              handlerName: result ? `block:${result.reason.split(".")[0].slice(0, 60)}` : "allow",
              durationMs,
              blocked: !!result?.block,
              timestamp: Date.now(),
            });
          }

          if (durationMs > 50) {
            console.warn(`[gsd-ext] tool_call handler took ${durationMs.toFixed(1)}ms for ${ev.toolName} — investigate performance`);
          }

          return result;
        });
      }
    },
  };
}
