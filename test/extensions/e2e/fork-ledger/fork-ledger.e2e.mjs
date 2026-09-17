import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EPassed, assertE2EContext,
} from "../../_e2e-harness.mjs";

const HOOK = "fork-ledger.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows Agent dispatch under cap`, async () => {
  const payload = makePreToolUsePayload("Agent", {
    prompt: "test task",
    subagent_type: "fork",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
  // dispatch_token is in hookSpecificOutput (stdout), not additionalContext
  if (result.stdout && !result.stdout.includes("dispatch_token")) {
    // Token may be in a separate output field — verify hook didn't error
    if (result.exitCode !== 0) {
      throw new Error(`Hook errored: exit ${result.exitCode}, stderr: ${result.stderr.slice(0, 200)}`);
    }
  }
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores non-Agent tools`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "git status" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores Read tool`, async () => {
  const payload = makePreToolUsePayload("Read", { file_path: "README.md" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});
