import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const HOOKS_DIR = join(homedir(), "gsd-config", "get-shit-done", "hooks");

export const E2E_CONFIG = {
  model: process.env.PI_TEST_MODEL || "gpt-6-sol",
  effort: process.env.PI_TEST_EFFORT || "high",
  provider: process.env.PI_TEST_PROVIDER || "openai",
  hooksDir: process.env.PI_TEST_HOOKS_DIR || HOOKS_DIR,
  timeout: parseInt(process.env.PI_TEST_TIMEOUT || "10000", 10),
};

export function makePreToolUsePayload(toolName, toolInput, opts = {}) {
  return {
    tool_name: toolName,
    tool_input: { ...toolInput },
    session_id: opts.session_id || `e2e-${Date.now()}`,
    model: opts.model || E2E_CONFIG.model,
    effort: opts.effort || E2E_CONFIG.effort,
    ...(opts.agent_id ? { agent_id: opts.agent_id } : {}),
    ...(opts.agent_type ? { agent_type: opts.agent_type } : {}),
  };
}

export function makePostToolUsePayload(toolName, toolInput, toolResponse, opts = {}) {
  return {
    tool_name: toolName,
    tool_input: { ...toolInput },
    tool_response: toolResponse,
    session_id: opts.session_id || `e2e-${Date.now()}`,
    model: opts.model || E2E_CONFIG.model,
    effort: opts.effort || E2E_CONFIG.effort,
    ...(opts.agent_id ? { agent_id: opts.agent_id } : {}),
  };
}

export function makeUserPromptPayload(prompt, opts = {}) {
  return {
    prompt,
    session_id: opts.session_id || `e2e-${Date.now()}`,
    model: opts.model || E2E_CONFIG.model,
    effort: opts.effort || E2E_CONFIG.effort,
  };
}

export function runHook(hookName, payload) {
  const hookPath = join(E2E_CONFIG.hooksDir, hookName);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Hook ${hookName} timed out after ${E2E_CONFIG.timeout}ms`));
    }, E2E_CONFIG.timeout);

    const child = spawn("node", [hookPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GSD_UE_PLANNING_GUARD: process.env.GSD_UE_PLANNING_GUARD || "on",
        CLAUDE_SESSION_ID: payload.session_id || `e2e-${Date.now()}`,
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      let parsed = null;
      try {
        const trimmed = stdout.trim();
        if (trimmed) parsed = JSON.parse(trimmed);
      } catch {}
      resolve({
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        parsed,
        blocked: parsed?.hookSpecificOutput?.permissionDecision === "deny",
        reason: parsed?.hookSpecificOutput?.permissionDecisionReason || null,
        context: parsed?.hookSpecificOutput?.additionalContext || null,
        updatedInput: parsed?.hookSpecificOutput?.updatedInput || null,
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export function assertE2EBlocked(result, reasonPattern) {
  if (!result.blocked) {
    throw new Error(
      `Expected hook to BLOCK but got: exitCode=${result.exitCode}, ` +
      `stdout=${result.stdout.slice(0, 200)}, stderr=${result.stderr.slice(0, 200)}`,
    );
  }
  if (reasonPattern && !reasonPattern.test(result.reason || "")) {
    throw new Error(`Block reason "${result.reason}" does not match ${reasonPattern}`);
  }
}

export function assertE2EPassed(result) {
  if (result.blocked) {
    throw new Error(`Expected hook to PASS but got blocked: ${result.reason}`);
  }
}

export function assertE2EContext(result, pattern) {
  if (!result.context) {
    throw new Error(`Expected additionalContext but got none. stdout=${result.stdout.slice(0, 200)}`);
  }
  if (pattern && !pattern.test(result.context)) {
    throw new Error(`Context "${result.context.slice(0, 200)}" does not match ${pattern}`);
  }
}
