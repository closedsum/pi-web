import path from "path";
import { parseLockFile, deriveDaemonStatus } from "../lock-schema";
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
  const lock = parseLockFile(lockPath);
  if (!lock) return undefined;

  const status = deriveDaemonStatus(lock, isProcessAlive);
  if (status.status !== "running" && status.status !== "stale") return undefined;

  const unverified = !status.identityVerified ? " (unverified — v1 lock)" : "";
  return {
    block: true,
    reason: `Auto-integration daemon is active (PID ${lock.data.pid})${unverified}. Use 'cancel --autopilot' to stop it first.`,
  };
}
