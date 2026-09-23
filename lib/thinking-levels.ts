import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** Thinking levels the pi runtime accepts, lowest to highest. Single source for pi-web. */
export const THINKING_LEVELS: ReadonlySet<ThinkingLevel> = new Set<ThinkingLevel>([
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel);
}
