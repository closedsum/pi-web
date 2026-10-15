import { readFileSync } from "fs";
import path from "path";
import { isProcessAlive } from "../process-liveness";
import { commandStr } from "./tool-blockers";
import type { BlockResult } from "./types";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

const INTEGRATE_RE = /\bgit\s+cherry-pick\b|\bgit\s+merge\b(?!-base)|gsd_impl_lane\.py\s+integrate/;

export function checkManualIntegrate(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): BlockResult | undefined {
  if (!SHELL_TOOLS.has(toolName)) return undefined;

  const cmd = commandStr(input);
  if (!INTEGRATE_RE.test(cmd)) return undefined;

  const lockPath = path.join(cwd, ".autopilot.lock");
  let lockData: { pid?: number };
  try {
    lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    return undefined;
  }

  if (typeof lockData.pid !== "number" || !isProcessAlive(lockData.pid)) {
    return undefined;
  }

  return {
    block: true,
    reason: `Auto-integration daemon is active (PID ${lockData.pid}). Use 'cancel --autopilot' to stop it first.`,
  };
}
