import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EBlocked, assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "fix-failure-gate.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows Edit with no failure state`, async () => {
  const payload = makePreToolUsePayload("Edit", {
    file_path: "src/main.ts",
    old_string: "a",
    new_string: "b",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows non-edit tools always`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "git status" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows Read tool`, async () => {
  const payload = makePreToolUsePayload("Read", { file_path: "src/main.ts" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});
