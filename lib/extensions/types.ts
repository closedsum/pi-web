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
