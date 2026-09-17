import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "doc-chain-check.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores non-git commands`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "npm test" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores git status`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "git status" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores non-Bash tools`, async () => {
  const payload = makePreToolUsePayload("Read", { file_path: "README.md" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] processes git commit`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: 'git commit -m "docs update"' });
  const result = await runHook(HOOK, payload);
  // May block (non-Python script) or pass (Python ok / no staged files)
  if (result.exitCode !== 0 && result.exitCode !== 2) {
    throw new Error(`Unexpected exit code: ${result.exitCode}`);
  }
});
