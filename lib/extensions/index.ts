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
import { TelemetryCollector, evaluateBlockRulesInstrumented } from "./telemetry-collector";
import { DebouncedWriter } from "./telemetry-writer";
import { evaluateResultRules, ALL_RESULT_RULES, createResultState, type ResultRule } from "./tool-results";
import { evaluateInputRules, ALL_INPUT_RULES } from "./input-handlers";
import { fireSessionStart, fireSessionEnd, trackToolCall, ALL_SESSION_RULES, createSessionState } from "./session-lifecycle";
import type { ToolCallEvent, ToolResultEvent, InputEvent, SessionStartEvent, SessionEndEvent, ExtensionTiming, InputRule, SessionRule, BlockRuleContext } from "./types";
import { resolveStateHome } from "../state-home";
import { checkManualIntegrate } from "./block-manual-integrate";
import { checkRedispatchWithoutFix } from "./block-redispatch";
import { ensureLaneDriver } from "./lane-driver-manager";
import { checkAuditScope } from "./audit-scope-extension";

export const GSD_EXTENSION_NAME = "pi-web-gsd-unified";

export interface GsdExtensionOptions {
  enableBlockRules?: boolean;
  enableResultRules?: boolean;
  enableInputRules?: boolean;
  enableSessionRules?: boolean;
  isSubagent?: boolean;
  blockRules?: readonly BlockRule[];
  resultRules?: readonly ResultRule[];
  inputRules?: readonly InputRule[];
  sessionRules?: readonly SessionRule[];
  onTiming?: (timing: ExtensionTiming) => void;
  enableTelemetry?: boolean;
}

export function createGsdExtension(options: GsdExtensionOptions = {}): InlineExtension {
  const enableBlockRules = options.enableBlockRules ?? true;
  const enableResultRules = options.enableResultRules ?? true;
  const enableInputRules = options.enableInputRules ?? true;
  const enableSessionRules = options.enableSessionRules ?? true;
  const blockRules = options.blockRules ?? ALL_RULES;
  const resultRules = options.resultRules ?? ALL_RESULT_RULES;
  const inputRules = options.inputRules ?? ALL_INPUT_RULES;
  const sessionRules = options.sessionRules ?? ALL_SESSION_RULES;
  const onTiming = options.onTiming;
  const enableTelemetry = options.enableTelemetry ?? true;

  let blockRuleCtx: BlockRuleContext | undefined;
  let auditScopeToken: string | undefined;
  let telemetryCollector: TelemetryCollector | undefined;
  let telemetryWriter: DebouncedWriter | undefined;

  return {
    name: GSD_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      (pi as any).on("session_start", (ev: SessionStartEvent) => {
        blockRuleCtx = {
          cwd: ev.cwd ?? process.cwd(),
          isSubagent: options.isSubagent ?? false,
          sessionId: ev.sessionId,
          stateHome: resolveStateHome(),
        };
        auditScopeToken = process.env.GSD_AUDIT_SCOPE_TOKEN || undefined;
        if (enableTelemetry && ev.sessionId) {
          telemetryCollector = new TelemetryCollector(ev.sessionId);
          telemetryWriter = new DebouncedWriter(telemetryCollector);
        }
        try {
          ensureLaneDriver(blockRuleCtx.cwd, blockRuleCtx.stateHome);
        } catch {
          // Lane driver spawn failure is non-fatal
        }
      });

      if (enableBlockRules) {
        pi.on("tool_call", (ev: ToolCallEvent) => {
          const start = performance.now();
          const result = telemetryCollector
            ? evaluateBlockRulesInstrumented(ev.toolName, ev.input ?? {}, blockRules, blockRuleCtx, telemetryCollector)
            : evaluateBlockRules(ev.toolName, ev.input ?? {}, blockRules, blockRuleCtx);
          const durationMs = performance.now() - start;
          telemetryWriter?.schedule();

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

        pi.on("tool_call", (ev: ToolCallEvent) => {
          const start = performance.now();
          const cwd = blockRuleCtx?.cwd ?? process.cwd();
          const scopeResult = auditScopeToken ? checkAuditScope(ev.toolName, ev.input ?? {}, auditScopeToken) : undefined;
          if (scopeResult) {
            if (onTiming) {
              onTiming({ event: "tool_call", handlerName: "audit-scope", durationMs: performance.now() - start, blocked: true, timestamp: Date.now() });
            }
            return scopeResult;
          }
          const result = checkManualIntegrate(ev.toolName, ev.input ?? {}, cwd)
                      ?? checkRedispatchWithoutFix(ev.toolName, ev.input ?? {}, cwd);
          const durationMs = performance.now() - start;
          if (onTiming) {
            onTiming({ event: "tool_call", handlerName: "inline-gates", durationMs, blocked: result?.block ?? false, timestamp: Date.now() });
          }
          return result;
        });
      }

      if (enableResultRules) {
        const resultState = createResultState();

        (pi as any).on("tool_result", (ev: ToolResultEvent) => {
          const start = performance.now();
          const action = evaluateResultRules(ev, resultState, resultRules);
          const durationMs = performance.now() - start;

          if (onTiming) {
            onTiming({
              event: "tool_result",
              handlerName: action ? `result:${action.context?.slice(1, 30) ?? action.warn?.slice(1, 30) ?? "action"}` : "pass",
              durationMs,
              blocked: false,
              timestamp: Date.now(),
            });
          }

          if (durationMs > 50) {
            console.warn(`[gsd-ext] tool_result handler took ${durationMs.toFixed(1)}ms for ${ev.toolName} — investigate performance`);
          }

          if (action?.context) {
            return { additionalContext: action.context };
          }
          if (action?.warn) {
            return { additionalContext: action.warn };
          }
          return undefined;
        });
      }

      if (enableInputRules) {
        (pi as any).on("input", (ev: InputEvent) => {
          const start = performance.now();
          const action = evaluateInputRules(ev, inputRules);
          const durationMs = performance.now() - start;

          if (onTiming) {
            onTiming({
              event: "input",
              handlerName: action ? `input:${action.action}` : "pass",
              durationMs,
              blocked: false,
              timestamp: Date.now(),
            });
          }

          if (durationMs > 50) {
            console.warn(`[gsd-ext] input handler took ${durationMs.toFixed(1)}ms — investigate performance`);
          }

          return action;
        });
      }

      if (enableSessionRules) {
        const sessionState = createSessionState();

        (pi as any).on("session_start", (ev: SessionStartEvent) => {
          const start = performance.now();
          fireSessionStart(ev, sessionState, sessionRules);
          const durationMs = performance.now() - start;
          if (onTiming) {
            onTiming({ event: "session_start", handlerName: "session-lifecycle", durationMs, blocked: false, timestamp: Date.now() });
          }
        });

        (pi as any).on("session_shutdown", (ev: SessionEndEvent) => {
          telemetryWriter?.stop();
          const start = performance.now();
          const messages = fireSessionEnd(ev, sessionState, sessionRules);
          const durationMs = performance.now() - start;
          if (onTiming) {
            onTiming({ event: "session_shutdown", handlerName: "session-lifecycle", durationMs, blocked: false, timestamp: Date.now() });
          }
          for (const msg of messages) {
            console.log(msg);
          }
        });

        pi.on("tool_call", (ev: ToolCallEvent) => {
          trackToolCall(ev.toolName, sessionState);
        });
      }
    },
  };
}
