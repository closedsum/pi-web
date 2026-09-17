import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EBlocked, assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "block_orchestrator_ue_planning.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] blocks ue_action.py from orchestrator`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "python ue_action.py build" });
  const result = await runHook(HOOK, payload);
  assertE2EBlocked(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows ue_action.py from subagent`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "python ue_action.py build" }, {
    agent_id: "ue-ops-1",
    agent_type: "ue-ops",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] blocks CsMCP catalog probe`, async () => {
  const payload = makePreToolUsePayload("Bash", {
    command: "python ue_csmcp_http.py catalog",
  });
  const result = await runHook(HOOK, payload);
  assertE2EBlocked(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows CsMCP status check`, async () => {
  const payload = makePreToolUsePayload("Bash", {
    command: "python ue_csmcp_http.py status",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] blocks Glob for .uasset`, async () => {
  const payload = makePreToolUsePayload("Glob", { pattern: "**/*.uasset" });
  const result = await runHook(HOOK, payload);
  assertE2EBlocked(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows Glob for .md in Content`, async () => {
  const payload = makePreToolUsePayload("Glob", { pattern: "Content/**/*.md" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] blocks reading verb manifest`, async () => {
  const payload = makePreToolUsePayload("Read", {
    file_path: "bin/ue/ue_action_verbs.json",
  });
  const result = await runHook(HOOK, payload);
  assertE2EBlocked(result);
});
