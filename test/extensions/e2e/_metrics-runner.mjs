import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { runHook, makePreToolUsePayload, makePostToolUsePayload, makeUserPromptPayload, E2E_CONFIG } from "../_e2e-harness.mjs";

const HOOKS_DIR = E2E_CONFIG.hooksDir;

const SCENARIOS = {
  "PreToolUse:Bash": () => makePreToolUsePayload("Bash", { command: "git status" }),
  "PreToolUse:Edit": () => makePreToolUsePayload("Edit", { file_path: "src/main.ts", old_string: "a", new_string: "b" }),
  "PreToolUse:Agent": () => makePreToolUsePayload("Agent", { prompt: "test task", subagent_type: "fork" }),
  "PreToolUse:Read": () => makePreToolUsePayload("Read", { file_path: "README.md" }),
  "PreToolUse:Glob": () => makePreToolUsePayload("Glob", { pattern: "**/*.ts" }),
  "PostToolUse:Bash": () => makePostToolUsePayload("Bash", { command: "git status" }, { exit_code: 0, stdout: "" }),
  "PostToolUse:TaskCreate": () => makePostToolUsePayload("TaskCreate", { subject: "test" }, { id: "t1", success: true }),
  "UserPromptSubmit": () => makeUserPromptPayload("fix the auth bug"),
};

function hookFiles() {
  try {
    return readdirSync(HOOKS_DIR)
      .filter((f) => f.endsWith(".cjs"))
      .map((f) => ({ name: f, path: join(HOOKS_DIR, f), size: statSync(join(HOOKS_DIR, f)).size }));
  } catch {
    return [];
  }
}

function estimateContextCost(result) {
  let bytes = 0;
  if (result.reason) bytes += Buffer.byteLength(result.reason);
  if (result.context) bytes += Buffer.byteLength(result.context);
  if (result.updatedInput) bytes += Buffer.byteLength(JSON.stringify(result.updatedInput));
  return bytes;
}

async function measureHook(hookName, scenario, payload) {
  const start = performance.now();
  let result;
  try {
    result = await runHook(hookName, payload);
  } catch (err) {
    return { hookName, scenario, error: err.message, ms: performance.now() - start };
  }
  const ms = performance.now() - start;
  return {
    hookName,
    scenario,
    ms: Math.round(ms * 100) / 100,
    exitCode: result.exitCode,
    blocked: result.blocked,
    hasContext: !!result.context,
    hasUpdatedInput: !!result.updatedInput,
    contextBytes: estimateContextCost(result),
    stdoutBytes: Buffer.byteLength(result.stdout || ""),
    stderrBytes: Buffer.byteLength(result.stderr || ""),
  };
}

async function main() {
  const hooks = hookFiles();
  console.log(`\n=== Hook E2E Metrics (${E2E_CONFIG.model} ${E2E_CONFIG.effort}) ===`);
  console.log(`Hooks found: ${hooks.length}`);
  console.log(`Scenarios: ${Object.keys(SCENARIOS).length}\n`);

  const results = [];
  const hookTimings = new Map();

  for (const hook of hooks) {
    const timings = [];
    for (const [scenarioName, makePayload] of Object.entries(SCENARIOS)) {
      const measurement = await measureHook(hook.name, scenarioName, makePayload());
      results.push(measurement);
      timings.push(measurement.ms);
    }
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    hookTimings.set(hook.name, { avg, max: Math.max(...timings), size: hook.size });
  }

  const sorted = [...hookTimings.entries()].sort((a, b) => b[1].avg - a[1].avg);
  console.log("--- Slowest hooks (avg ms across scenarios) ---");
  for (const [name, t] of sorted.slice(0, 15)) {
    console.log(`  ${name.padEnd(45)} avg=${t.avg.toFixed(0)}ms  max=${t.max.toFixed(0)}ms  size=${t.size}b`);
  }

  const blockers = results.filter((r) => r.blocked);
  const contextInjectors = results.filter((r) => r.hasContext);
  const noops = results.filter((r) => !r.blocked && !r.hasContext && !r.hasUpdatedInput && r.exitCode === 0);
  const errors = results.filter((r) => r.error);

  console.log(`\n--- Summary ---`);
  console.log(`Total measurements: ${results.length}`);
  console.log(`Blocks: ${blockers.length} (${(blockers.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Context injections: ${contextInjectors.length} (${(contextInjectors.length / results.length * 100).toFixed(1)}%)`);
  console.log(`No-ops (pass-through): ${noops.length} (${(noops.length / results.length * 100).toFixed(1)}%)`);
  console.log(`Errors: ${errors.length}`);

  const totalContextBytes = contextInjectors.reduce((sum, r) => sum + r.contextBytes, 0);
  const avgContextBytes = contextInjectors.length ? Math.round(totalContextBytes / contextInjectors.length) : 0;
  console.log(`\n--- Token cost (context injection) ---`);
  console.log(`Total context bytes injected: ${totalContextBytes}`);
  console.log(`Avg context bytes per injection: ${avgContextBytes}`);
  console.log(`Estimated tokens per injection: ~${Math.round(avgContextBytes / 4)}`);

  const totalMs = results.reduce((sum, r) => sum + (r.ms || 0), 0);
  const avgMs = results.length ? Math.round(totalMs / results.length) : 0;
  console.log(`\n--- Timing ---`);
  console.log(`Total wall time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Avg per hook invocation: ${avgMs}ms`);

  if (errors.length > 0) {
    console.log(`\n--- Errors ---`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  ${e.hookName} [${e.scenario}]: ${e.error}`);
    }
  }

  const heavyContext = results
    .filter((r) => r.contextBytes > 500)
    .sort((a, b) => b.contextBytes - a.contextBytes);
  if (heavyContext.length > 0) {
    console.log(`\n--- Heavy context injections (>500 bytes) ---`);
    for (const r of heavyContext.slice(0, 10)) {
      console.log(`  ${r.hookName.padEnd(45)} ${r.scenario.padEnd(25)} ${r.contextBytes}b (~${Math.round(r.contextBytes / 4)} tokens)`);
    }
  }

  const duplicateLogic = new Map();
  for (const r of results) {
    if (r.blocked) {
      const key = r.hookName.replace(/[-_]/g, "").replace(/\.cjs$/, "");
      if (!duplicateLogic.has(key)) duplicateLogic.set(key, []);
      duplicateLogic.get(key).push(r.scenario);
    }
  }

  console.log(`\n=== Done ===\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
