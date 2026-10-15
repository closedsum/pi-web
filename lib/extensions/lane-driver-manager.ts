import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { isProcessAlive } from "../process-liveness";

interface LaneDriverOptions {
  spawner?: (...args: unknown[]) => { pid: number; unref(): void };
  aliveCheck?: (pid: number) => boolean;
  tempDir?: string;
}

const BACKOFF_WINDOW_MS = 60_000;
const BACKOFF_MAX_RESTARTS = 3;

export function projectHash(cwd: string): string {
  return createHash("md5").update(cwd.toLowerCase()).digest("hex").slice(0, 12);
}

function isEligible(cwd: string, tempDir?: string): boolean {
  if (!existsSync(path.join(cwd, ".planning", "config.json"))) return false;
  if (existsSync(path.join(cwd, ".planning", "driver.stop"))) return false;
  const resolved = path.resolve(cwd);
  const tmpBase = tempDir ?? tmpdir();
  if (resolved.startsWith(tmpBase)) return false;
  const dotGit = path.join(cwd, ".git");
  try {
    const stat = statSync(dotGit);
    if (stat.isFile()) return false;
  } catch {
    return false;
  }
  return true;
}

function isBackedOff(stateHome: string, hash: string): boolean {
  const backoffPath = path.join(stateHome, "lane-driver", `${hash}.backoff`);
  try {
    const entries: number[] = JSON.parse(readFileSync(backoffPath, "utf-8"));
    const cutoff = Date.now() - BACKOFF_WINDOW_MS;
    const recent = entries.filter((t) => t > cutoff);
    return recent.length >= BACKOFF_MAX_RESTARTS;
  } catch {
    return false;
  }
}

function recordRestart(stateHome: string, hash: string): void {
  const dir = path.join(stateHome, "lane-driver");
  mkdirSync(dir, { recursive: true });
  const backoffPath = path.join(dir, `${hash}.backoff`);
  let entries: number[] = [];
  try {
    entries = JSON.parse(readFileSync(backoffPath, "utf-8"));
  } catch { /* fresh */ }
  entries.push(Date.now());
  const cutoff = Date.now() - BACKOFF_WINDOW_MS;
  entries = entries.filter((t) => t > cutoff);
  writeFileSync(backoffPath, JSON.stringify(entries));
}

function isDaemonAlive(stateHome: string, hash: string, aliveCheck: (pid: number) => boolean): boolean {
  const lockPath = path.join(stateHome, "lane-driver", `${hash}.lock`);
  try {
    const data = JSON.parse(readFileSync(lockPath, "utf-8"));
    if (typeof data.pid === "number" && aliveCheck(data.pid)) return true;
  } catch { /* corrupt or missing — treat as dead */ }
  return false;
}

export function ensureLaneDriver(
  cwd: string,
  stateHome: string,
  opts: LaneDriverOptions = {},
): void {
  const aliveCheck = opts.aliveCheck ?? isProcessAlive;
  const tempDir = opts.tempDir;

  if (!isEligible(cwd, tempDir)) return;

  const hash = projectHash(cwd);

  if (isDaemonAlive(stateHome, hash, aliveCheck)) return;

  if (isBackedOff(stateHome, hash)) return;

  const dir = path.join(stateHome, "lane-driver");
  mkdirSync(dir, { recursive: true });

  if (opts.spawner) {
    const child = opts.spawner("python", [
      "gsd_lane_driver.py", "run", "--detach",
    ], { cwd, detached: true });
    writeFileSync(path.join(dir, `${hash}.lock`), JSON.stringify({ pid: child.pid, started_at: new Date().toISOString() }));
    child.unref();
  } else {
    const { spawn } = require("child_process");
    const driverPath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".claude", "get-shit-done", "bin", "gsd_lane_driver.py");
    const child = spawn("python", [driverPath, "run", "--detach"], {
      cwd,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    writeFileSync(path.join(dir, `${hash}.lock`), JSON.stringify({ pid: child.pid, started_at: new Date().toISOString() }));
    child.unref();
  }

  recordRestart(stateHome, hash);
}
