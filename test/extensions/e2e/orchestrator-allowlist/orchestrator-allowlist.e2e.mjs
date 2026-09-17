import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EBlocked, assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "orchestrator-allowlist.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] blocks pytest from orchestrator`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "pytest tests/" });
  const result = await runHook(HOOK, payload);
  assertE2EBlocked(result, /ORCHESTRATOR-ALLOWLIST/);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows git status`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "git status" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows lane dispatch`, async () => {
  const payload = makePreToolUsePayload("Bash", {
    command: "python gsd_impl_lane.py queue --params-file spec.json",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows from subagent`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "pytest tests/" }, {
    agent_id: "fork-1",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] blocks npm test`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "npm test" });
  const result = await runHook(HOOK, payload);
  assertE2EBlocked(result, /ORCHESTRATOR-ALLOWLIST/);
});
