/**
 * Tool call blockers for pi extensions.
 * Ports Claude Code PreToolUse block-* hooks into pi's tool_call event.
 *
 * Each rule is a pure function: (toolName, input) => BlockResult | undefined.
 * Rules are scope-isolated and individually testable.
 */
import type { BlockResult } from "./types";

export interface BlockRule {
  name: string;
  test: (toolName: string, input: Record<string, unknown>) => BlockResult | undefined;
}

const inputStr = (input: Record<string, unknown>, key: string): string =>
  typeof input[key] === "string" ? (input[key] as string) : "";

const commandStr = (input: Record<string, unknown>): string =>
  inputStr(input, "command") || inputStr(input, "script");

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// --- Individual block rules ---

export const blockBashPython: BlockRule = {
  name: "block-bash-python",
  test(toolName, input) {
    if (toolName !== "Bash") return;
    const cmd = commandStr(input);
    if (/\bpython\s+-c\b/.test(cmd)) {
      return { block: true, reason: "Inline python -c is blocked. Use a script file or the Python tool." };
    }
  },
};

export const blockBroadUeKill: BlockRule = {
  name: "block-broad-ue-kill",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\btaskkill\b.*\/im\s+["']?UnrealEditor/i.test(cmd) && !/\/pid\s+\d/i.test(cmd)) {
      return { block: true, reason: "Broad UE kill blocked — use PID-targeted kill or ue_action.py stop." };
    }
  },
};

export const blockDirectConsoleHttp: BlockRule = {
  name: "block-direct-console-http",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\bcurl\b.*localhost:\d+\/remote\//.test(cmd) || /Invoke-WebRequest.*localhost:\d+\/remote\//.test(cmd)) {
      return { block: true, reason: "Direct HTTP to UE console is blocked. Use ue_action.py or CsMCP tools." };
    }
  },
};

export const blockDirectEditorLaunch: BlockRule = {
  name: "block-direct-editor-launch",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/UnrealEditor(?:-\w+)?\.exe\b/.test(cmd) && !/ue_action\.py/.test(cmd)) {
      return { block: true, reason: "Direct editor launch blocked. Use ue_action.py launch or ue_dispatch." };
    }
  },
};

export const blockForkPush: BlockRule = {
  name: "block-fork-push",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\bgit\s+push\b/.test(cmd)) {
      return { block: true, reason: "Git push is blocked in agent sessions. Let the orchestrator handle merges." };
    }
  },
};

export const blockLaunchPortOverride: BlockRule = {
  name: "block-launch-port-override",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/ue_action\.py\s+launch\b/.test(cmd) && /--port\b/.test(cmd)) {
      return { block: true, reason: "Port override on ue_action.py launch is blocked. Port is managed by config." };
    }
  },
};

export const blockLivecoding: BlockRule = {
  name: "block-livecoding",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\bLiveCod(?:ing|e)\b/i.test(cmd)) {
      return { block: true, reason: "LiveCoding commands are blocked. Use the standard build pipeline." };
    }
  },
};

export const blockMonitorKillSignal: BlockRule = {
  name: "block-monitor-kill-signal",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\btaskkill\b/i.test(cmd) && /\bpython\b/i.test(cmd) && /monitor/i.test(cmd)) {
      return { block: true, reason: "Killing monitor processes is blocked. Use the monitor's own stop mechanism." };
    }
  },
};

export const blockPsUtf8Bom: BlockRule = {
  name: "block-ps-utf8-bom",
  test(toolName, input) {
    if (toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/Out-File\b/.test(cmd) && !/\-Encoding\s+utf8NoBOM/i.test(cmd) && /\.(?:py|json|md|txt|ts|js|mjs)\b/.test(cmd)) {
      return { block: true, reason: "PowerShell Out-File without -Encoding utf8NoBOM adds a BOM. Use Write tool or add -Encoding utf8NoBOM." };
    }
  },
};

export const blockRawUeConsole: BlockRule = {
  name: "block-raw-ue-console",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\bpy\.exec\b/.test(cmd) || /\bunreal\..*execute_console_command\b/.test(cmd)) {
      return { block: true, reason: "Raw UE console commands are blocked. Use ue_action.py or CsMCP tools." };
    }
  },
};

export const blockResearchFork: BlockRule = {
  name: "block-research-fork",
  test(toolName, input) {
    if (toolName !== "Agent") return;
    const prompt = inputStr(input, "prompt").toLowerCase();
    const subType = inputStr(input, "subagent_type");
    if (subType === "fork" && /\b(?:research|compare|evaluate|which.*(?:best|better)|pros.*cons|trade.?off)\b/.test(prompt)) {
      return { block: true, reason: "Research must be multi-model. Use /gsd:cross-research, not a single-model fork." };
    }
  },
};

export const blockSendFeedback: BlockRule = {
  name: "block-send-feedback",
  test(toolName) {
    if (toolName === "SendFeedback") {
      return { block: true, reason: "SendFeedback is disabled. Report issues through the project's issue tracker." };
    }
  },
};

export const blockStandaloneUeBypass: BlockRule = {
  name: "block-standalone-ue-bypass",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/ue_action\.py\b/.test(cmd) && /--standalone\b/.test(cmd)) {
      return { block: true, reason: "Standalone UE bypass is blocked. Use the standard editor lifecycle." };
    }
  },
};

export const blockUePythonProbe: BlockRule = {
  name: "block-ue-python-probe",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\bimport\s+unreal\b/.test(cmd) || /\bfrom\s+unreal\s+import\b/.test(cmd)) {
      return { block: true, reason: "Direct UE Python probing is blocked. Use CsMCP tools for UE interaction." };
    }
  },
};

export const blockUeRotatorPositional: BlockRule = {
  name: "block-ue-rotator-positional",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\bFRotator\s*\(\s*\d/.test(cmd)) {
      return { block: true, reason: "FRotator positional construction is blocked (pitch/yaw/roll order is unintuitive). Use named parameters." };
    }
  },
};

export const denyJunctionSurgery: BlockRule = {
  name: "deny-junction-surgery",
  test(toolName, input) {
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (/\b(?:mklink\s+\/[jd]|New-Item.*SymbolicLink|junction)\b/i.test(cmd) && /plugin/i.test(cmd)) {
      return { block: true, reason: "Junction surgery on plugin directories is blocked. Use the plugin distribution system." };
    }
  },
};

// --- Rule registry ---

export const ALL_RULES: readonly BlockRule[] = [
  blockBashPython,
  blockBroadUeKill,
  blockDirectConsoleHttp,
  blockDirectEditorLaunch,
  blockForkPush,
  blockLaunchPortOverride,
  blockLivecoding,
  blockMonitorKillSignal,
  blockPsUtf8Bom,
  blockRawUeConsole,
  blockResearchFork,
  blockSendFeedback,
  blockStandaloneUeBypass,
  blockUePythonProbe,
  blockUeRotatorPositional,
  denyJunctionSurgery,
];

/**
 * Evaluate all block rules against a tool call.
 * Returns the first matching BlockResult, or undefined if allowed.
 */
export function evaluateBlockRules(
  toolName: string,
  input: Record<string, unknown>,
  rules: readonly BlockRule[] = ALL_RULES,
): BlockResult | undefined {
  for (const rule of rules) {
    const result = rule.test(toolName, input);
    if (result) return result;
  }
  return undefined;
}
