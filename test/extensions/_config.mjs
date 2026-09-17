export const TEST_CONFIG = {
  model: process.env.PI_TEST_MODEL || "gpt-5.6-sol",
  effort: process.env.PI_TEST_EFFORT || "high",
  provider: process.env.PI_TEST_PROVIDER || "openai",
};

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
