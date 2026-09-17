import test from "node:test";
import {
  E2E_CONFIG, runHook, makePostToolUsePayload,
  assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "fix-failure-tracker.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] tracks successful pytest (resets count)`, async () => {
  const payload = makePostToolUsePayload("Bash", { command: "pytest tests/" }, { exit_code: 0 });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores git commands`, async () => {
  const payload = makePostToolUsePayload("Bash", { command: "git status" }, { exit_code: 0 });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores non-Bash tools`, async () => {
  const payload = makePostToolUsePayload("Edit", { file_path: "x.ts" }, { success: true });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] tracks failed pytest`, async () => {
  const payload = makePostToolUsePayload("Bash", { command: "pytest tests/" }, { exit_code: 1 });
  const result = await runHook(HOOK, payload);
  // First failure shouldn't inject context (needs 2+ to trigger gate)
  assertE2EPassed(result);
});
