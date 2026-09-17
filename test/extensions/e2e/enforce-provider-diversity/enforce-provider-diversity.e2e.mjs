import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "enforce-provider-diversity.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores non-Agent tools`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "git status" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] ignores Agent without manifest`, async () => {
  const payload = makePreToolUsePayload("Agent", { prompt: "simple fork" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] processes Agent with wave manifest`, async () => {
  const payload = makePreToolUsePayload("Agent", {
    parallel_tasks_manifest: {
      wave: [
        { subject: "task1", task_type: "review" },
        { subject: "task2", task_type: "research" },
        { subject: "task3", task_type: "narrow" },
      ],
    },
  });
  const result = await runHook(HOOK, payload);
  // Should allow with updatedInput containing assigned providers
  assertE2EPassed(result);
  if (result.updatedInput?.parallel_tasks_manifest) {
    const wave = result.updatedInput.parallel_tasks_manifest.wave;
    const providers = new Set(wave.map((t) => t.provider));
    if (providers.size < 2) {
      throw new Error(`Expected diverse providers but got: ${[...providers].join(", ")}`);
    }
  }
});
