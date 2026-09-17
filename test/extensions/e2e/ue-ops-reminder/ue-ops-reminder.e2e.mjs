import test from "node:test";
import {
  E2E_CONFIG, runHook, makeUserPromptPayload,
  assertE2EPassed, assertE2EContext,
} from "../../_e2e-harness.mjs";

const HOOK = "ue_ops_reminder.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] injects reminder for UE intent`, async () => {
  const payload = makeUserPromptPayload("launch the editor");
  const result = await runHook(HOOK, payload);
  assertE2EContext(result, /UE-OPS/);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] injects reminder for start PIE`, async () => {
  const payload = makeUserPromptPayload("start PIE and test the bot");
  const result = await runHook(HOOK, payload);
  assertE2EContext(result, /UE-OPS/);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] no reminder for non-UE prompt`, async () => {
  const payload = makeUserPromptPayload("fix the auth bug in the login page");
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
  if (result.context) {
    throw new Error(`Expected no context but got: ${result.context.slice(0, 100)}`);
  }
});
