import test from "node:test";
import { E2E_CONFIG, runHook } from "../../_e2e-harness.mjs";

const HOOK = "task-board-restore.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] runs on session start payload`, async () => {
  const payload = { source: "startup", cwd: process.cwd() };
  const result = await runHook(HOOK, payload);
  // Should not error — may or may not inject context depending on board state
  if (result.exitCode !== 0) {
    throw new Error(`Unexpected exit code: ${result.exitCode}, stderr: ${result.stderr.slice(0, 200)}`);
  }
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] runs on resume payload`, async () => {
  const payload = { source: "resume", cwd: process.cwd() };
  const result = await runHook(HOOK, payload);
  if (result.exitCode !== 0) {
    throw new Error(`Unexpected exit code: ${result.exitCode}`);
  }
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] runs on clear payload`, async () => {
  const payload = { source: "clear", cwd: process.cwd() };
  const result = await runHook(HOOK, payload);
  if (result.exitCode !== 0) {
    throw new Error(`Unexpected exit code: ${result.exitCode}`);
  }
});
