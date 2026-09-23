import { readFileSync } from "node:fs";

// Single source: test/test-model.json. PI_TEST_* env vars override per run.
const TEST_MODEL_KEYS = ["provider", "model", "effort"];
export const TEST_MODEL_FILE = JSON.parse(readFileSync(new URL("../test-model.json", import.meta.url), "utf8"));

/**
 * Throws naming the bad keys unless cfg is an object whose provider/model/effort
 * are non-empty strings without whitespace. No in-repo model-ID roster exists
 * (models come from ~/.pi/agent at runtime), so the format is what we can check.
 */
export function validateTestModel(cfg, source = "test/test-model.json") {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    throw new Error(`${source} must be a JSON object with ${TEST_MODEL_KEYS.join(", ")}`);
  }
  const bad = TEST_MODEL_KEYS.filter((key) => typeof cfg[key] !== "string" || !/^\S+$/.test(cfg[key]));
  if (bad.length) throw new Error(`${source} missing or invalid: ${bad.join(", ")}`);
  return cfg;
}

export function resolveTestModel(env, file) {
  validateTestModel(file);
  return validateTestModel({
    model: env.PI_TEST_MODEL || file.model,
    effort: env.PI_TEST_EFFORT || file.effort,
    provider: env.PI_TEST_PROVIDER || file.provider,
  }, "test model after PI_TEST_* overrides");
}

export const TEST_CONFIG = resolveTestModel(process.env, TEST_MODEL_FILE);

export function makeToolCallEvent(toolName, args = {}) {
  return {
    tool: toolName,
    input: { ...args },
    provider: TEST_CONFIG.provider,
    model: TEST_CONFIG.model,
    effort: TEST_CONFIG.effort,
  };
}

export function makeBashToolCallEvent(command) {
  return makeToolCallEvent("Bash", { command });
}

export function makePowerShellToolCallEvent(command) {
  return makeToolCallEvent("PowerShell", { command });
}

export function makeReadToolCallEvent(filePath) {
  return makeToolCallEvent("Read", { file_path: filePath });
}

export function makeAgentToolCallEvent(prompt, subagentType = "fork") {
  return makeToolCallEvent("Agent", { prompt, subagent_type: subagentType });
}

export function assertBlocked(result, reasonPattern) {
  if (!result || !result.block) {
    throw new Error(`Expected block but got: ${JSON.stringify(result)}`);
  }
  if (reasonPattern && !reasonPattern.test(result.reason || "")) {
    throw new Error(`Block reason "${result.reason}" does not match ${reasonPattern}`);
  }
}

export function assertPassed(result) {
  if (result && result.block) {
    throw new Error(`Expected pass but got block: ${result.reason}`);
  }
}
