import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EBlocked, assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "commit-gate.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows non-git commands`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "npm test" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows git status`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "git status" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] allows git log`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "git log --oneline -5" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] processes git commit (advisory or gate)`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: 'git commit -m "test"' });
  const result = await runHook(HOOK, payload);
  // commit-gate either allows (small commit) or blocks (large without evidence)
  // Both are valid responses — verify it responded without error
  if (result.exitCode !== 0 && result.exitCode !== 2) {
    throw new Error(`Unexpected exit code: ${result.exitCode}`);
  }
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores non-Bash/PS tools`, async () => {
  const payload = makePreToolUsePayload("Edit", { file_path: "x.ts", old_string: "a", new_string: "b" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});
