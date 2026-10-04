/**
 * Shared types for pi extension modules.
 * Single source — import from here, not inline annotations.
 */

export interface ToolCallEvent {
  toolName: string;
  input?: Record<string, unknown>;
}

export interface BlockResult {
  block: true;
  reason: string;
  terminate?: boolean;
}

export interface ExtensionTiming {
  event: string;
  handlerName: string;
  durationMs: number;
  blocked: boolean;
  timestamp: number;
}

export interface ToolResultEvent {
  toolName: string;
  input?: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  exitCode?: number;
}

export interface ResultAction {
  context?: string;
  warn?: string;
}

export interface ResultRuleState {
  lastCommitTime: number;
  lastBuildTime: number;
  commitCount: number;
  linesSinceReview: number;
}

export interface InputEvent {
  text: string;
  source?: string;
}

export interface InputAction {
  action: "transform" | "handled" | "continue";
  text?: string;
}

export interface InputRule {
  name: string;
  test: (ev: InputEvent) => InputAction | undefined;
}

export interface SessionStartEvent {
  sessionId?: string;
  cwd?: string;
}

export interface SessionEndEvent {
  sessionId?: string;
}

export interface SessionState {
  startTime: number;
  sessionId?: string;
  forkCount: number;
  dispatchCount: number;
}

export interface SessionRule {
  name: string;
  onStart?: (ev: SessionStartEvent, state: SessionState) => void;
  onEnd?: (ev: SessionEndEvent, state: SessionState) => string | undefined;
}
