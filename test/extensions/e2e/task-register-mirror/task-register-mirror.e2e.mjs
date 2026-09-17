import test from "node:test";
import {
  E2E_CONFIG, runHook, makePostToolUsePayload,
  assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "task-register-mirror.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] processes TaskCreate result`, async () => {
  const payload = makePostToolUsePayload(
    "TaskCreate",
    { subject: "E2E test task", description: "Testing register mirror" },
    { id: "e2e-t1", success: true },
  );
  const result = await runHook(HOOK, payload);
  // Mirror may succeed or fail-open depending on active thread state
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores non-task tools`, async () => {
  const payload = makePostToolUsePayload("Bash", { command: "ls" }, { exit_code: 0 });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] skips on error response`, async () => {
  const payload = makePostToolUsePayload(
    "TaskCreate",
    { subject: "fail" },
    { isError: true, error: "test error" },
  );
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});
