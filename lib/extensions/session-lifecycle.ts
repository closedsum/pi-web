/**
 * Session lifecycle handlers for pi extensions.
 * Ports Claude Code SessionStart/SessionEnd hooks to pi's session_start/session_shutdown events.
 *
 * Each rule has optional onStart/onEnd methods. State is per-session via createSessionState().
 * The tool_call event is also observed to track fork/dispatch counts without blocking.
 */
import type { SessionStartEvent, SessionEndEvent, SessionState, SessionRule } from "./types";

export function createSessionState(): SessionState {
  return {
    startTime: 0,
    sessionId: undefined,
    forkCount: 0,
    dispatchCount: 0,
  };
}

export const sessionTracker: SessionRule = {
  name: "session-tracker",
  onStart(ev, state) {
    state.startTime = Date.now();
    state.sessionId = ev.sessionId;
    state.forkCount = 0;
    state.dispatchCount = 0;
  },
};

export const processCleanup: SessionRule = {
  name: "process-cleanup",
  onEnd(_ev, state) {
    if (state.forkCount > 0 || state.dispatchCount > 0) {
      return `[gsd-ext] Session ended: ${state.forkCount} forks, ${state.dispatchCount} dispatches — verify owned processes are stopped`;
    }
    return undefined;
  },
};

export const sessionMetrics: SessionRule = {
  name: "session-metrics",
  onEnd(_ev, state) {
    if (state.startTime <= 0) return undefined;
    const durationMs = Date.now() - state.startTime;
    const durationMin = (durationMs / 60_000).toFixed(1);
    return `[gsd-ext] Session duration: ${durationMin}m | forks: ${state.forkCount} | dispatches: ${state.dispatchCount}`;
  },
};

export const ALL_SESSION_RULES: readonly SessionRule[] = [
  sessionTracker,
  processCleanup,
  sessionMetrics,
];

export function fireSessionStart(
  ev: SessionStartEvent,
  state: SessionState,
  rules: readonly SessionRule[] = ALL_SESSION_RULES,
): void {
  for (const rule of rules) {
    rule.onStart?.(ev, state);
  }
}

export function fireSessionEnd(
  ev: SessionEndEvent,
  state: SessionState,
  rules: readonly SessionRule[] = ALL_SESSION_RULES,
): string[] {
  const messages: string[] = [];
  for (const rule of rules) {
    const msg = rule.onEnd?.(ev, state);
    if (msg) messages.push(msg);
  }
  return messages;
}

export function trackToolCall(toolName: string, state: SessionState): void {
  if (toolName === "Agent") state.forkCount++;
  if (toolName === "DispatchLane" || toolName === "ue_dispatch") state.dispatchCount++;
}
