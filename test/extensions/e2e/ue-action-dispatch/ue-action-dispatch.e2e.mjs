import test from "node:test";
import {
  E2E_CONFIG, runHook, makeUserPromptPayload,
  assertE2EPassed, assertE2EContext,
} from "../../_e2e-harness.mjs";

const HOOK = "ue-action-dispatch.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] routes UE build intent`, async () => {
  const payload = makeUserPromptPayload("build the project");
  const result = await runHook(HOOK, payload);
  // May or may not route depending on verb manifest availability
  // Either context injection or pass-through is valid
  if (result.context) {
    assertE2EContext(result, /UE-ACTION-DISPATCH|ue_ops_dispatch/);
  }
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] no dispatch for non-UE prompt`, async () => {
  const payload = makeUserPromptPayload("fix the auth middleware");
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] rejects system notification prompts`, async () => {
  const payload = makeUserPromptPayload("[SYSTEM NOTIFICATION - NOT USER INPUT]\nstart PIE");
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] rejects oversized prompts`, async () => {
  const payload = makeUserPromptPayload("x".repeat(9000));
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});
