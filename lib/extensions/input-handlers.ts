/**
 * Input event handlers for pi extensions.
 * Ports Claude Code UserPromptSubmit hooks to pi's `input` event.
 *
 * Each rule is a pure function: (ev: InputEvent) => InputAction | undefined.
 * Rules use the pi SDK's action-based return: {action: "transform", text} to
 * prepend/append context to the user's prompt, or {action: "continue"} to pass.
 */
import type { InputEvent, InputAction, InputRule } from "./types";

const BUG_SIGNALS = ["bug", "error", "crash", "broken", "fails", "regression", "doesn't work", "not working"];
const TRIVIAL_SIGNALS = ["typo", "rename", "bump version", "gitignore", "missing import", "config change"];
const QUESTION_RE = /^(?:what|how|why|can|does|is|are|where|which|explain)\s/i;
const SKIP_PREFIXES = ["/", "!"];
const CONVERSATIONAL = ["thanks", "got it", "sounds good", "ok", "yes", "no", "go ahead", "lgtm"];
const GAP_SIGNALS = ["gap", "missing", "shortcoming", "doesn't exist", "not implemented", "no way to", "can't find", "should have", "needs a"];

function isSkippable(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length < 15) return true;
  if (SKIP_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (lower.endsWith("?") || QUESTION_RE.test(lower)) return true;
  if (CONVERSATIONAL.some((c) => lower === c)) return true;
  return false;
}

export const taskRouting: InputRule = {
  name: "task-routing",
  test(ev) {
    if (ev.source === "extension") return undefined;
    if (isSkippable(ev.text)) return undefined;
    const lower = ev.text.toLowerCase();
    for (const s of BUG_SIGNALS) {
      if (lower.includes(s)) {
        return { action: "transform", text: ev.text + "\n\n[TASK-ROUTING] Bug signals detected. Route to bug-fix workflow." };
      }
    }
    for (const s of TRIVIAL_SIGNALS) {
      if (lower.includes(s)) {
        return { action: "transform", text: ev.text + "\n\n[TASK-ROUTING] Trivial task detected. Route to fast/quick workflow." };
      }
    }
    return undefined;
  },
};

export const gapEnforcement: InputRule = {
  name: "gap-enforcement",
  test(ev) {
    if (ev.source === "extension") return undefined;
    const lower = ev.text.toLowerCase();
    if (GAP_SIGNALS.some((s) => lower.includes(s))) {
      return {
        action: "transform",
        text: ev.text + "\n\n[GAP-ENFORCEMENT] If you identified ANY gap, tooling shortcoming, missing feature, or unexpected behavior, file it immediately via TaskCreate or add-todo.",
      };
    }
    return undefined;
  },
};

export const sessionReminder: InputRule = {
  name: "session-reminder",
  test(ev) {
    if (ev.source === "extension") return undefined;
    if (isSkippable(ev.text)) return undefined;
    return {
      action: "transform",
      text: ev.text + "\n\n[SESSION-REMINDER] Superpowers skills are mandatory before code changes. Verify before completing.",
    };
  },
};

export const ALL_INPUT_RULES: readonly InputRule[] = [
  taskRouting,
  gapEnforcement,
  sessionReminder,
];

/**
 * Evaluate all input rules against a user prompt.
 * Returns the first matching InputAction (first rule wins — order matters).
 * Later rules can still append by design: taskRouting adds routing context,
 * sessionReminder adds reminders. The first transform wins at the pi SDK level.
 */
export function evaluateInputRules(
  ev: InputEvent,
  rules: readonly InputRule[] = ALL_INPUT_RULES,
): InputAction | undefined {
  for (const rule of rules) {
    const result = rule.test(ev);
    if (result && result.action !== "continue") return result;
  }
  return undefined;
}
