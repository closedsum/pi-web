import test from "node:test";
import {
  E2E_CONFIG, runHook, makePreToolUsePayload,
  assertE2EPassed,
} from "../../_e2e-harness.mjs";

const HOOK = "observe-effectiveness.cjs";

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] never blocks (observe-only contract)`, async () => {
  const payload = makePreToolUsePayload("Bash", {
    command: "taskkill /IM UnrealEditor.exe /F",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] approves unmatched commands`, async () => {
  const payload = makePreToolUsePayload("Bash", { command: "npm test" });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
  if (result.parsed) {
    const decision = result.parsed?.hookSpecificOutput?.permissionDecision;
    if (decision) {
      const assert = (await import("node:assert/strict")).default;
      assert.equal(decision, "approve");
    }
  }
});

test(`[E2E ${E2E_CONFIG.model} ${E2E_CONFIG.effort}] approves Rotator with keyword args`, async () => {
  const payload = makePreToolUsePayload("Bash", {
    command: "unreal.Rotator(roll=0, pitch=90, yaw=0)",
  });
  const result = await runHook(HOOK, payload);
  assertE2EPassed(result);
});
