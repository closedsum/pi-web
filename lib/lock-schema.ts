import { readFileSync } from "fs";

export interface LockDataV1 {
  schema?: undefined;
  pid: number;
  started_at?: string;
}

export interface LockDataV2 {
  schema: 2;
  pid: number;
  proc_start: number;
  boot_id: string;
  instance_nonce: string;
  heartbeat_seq: number;
  heartbeat_at: string;
  state: "running" | "stopping" | "errored";
  last_error: string | null;
}

export type LockData = LockDataV1 | LockDataV2;

export interface ParsedLock {
  data: LockData;
  schemaVersion: 1 | 2;
  identityVerified: boolean;
  raw: string;
}

export type DaemonStatus =
  | "running"
  | "stopped"
  | "errored"
  | "stale"
  | "unknown";

export interface DaemonStatusResult {
  status: DaemonStatus;
  reason: string;
  heartbeatAgeMs: number | null;
  schemaVersion: 1 | 2;
  identityVerified: boolean;
}

const STALE_THRESHOLD_MS = 15_000;

const V2_REQUIRED_FIELDS = [
  "pid",
  "proc_start",
  "boot_id",
  "instance_nonce",
  "heartbeat_seq",
  "heartbeat_at",
  "state",
] as const;

function isValidV2(data: Record<string, unknown>): boolean {
  if (data.schema !== 2) return false;
  for (const field of V2_REQUIRED_FIELDS) {
    if (!(field in data) || data[field] == null) return false;
  }
  return true;
}

export function parseLockFile(filePath: string): ParsedLock | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  if (!raw.trim()) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null) return null;

  if (data.schema === 2) {
    if (!isValidV2(data)) return null;
    return {
      data: data as unknown as LockDataV2,
      schemaVersion: 2,
      identityVerified: true,
      raw,
    };
  }

  if (typeof data.pid !== "number") return null;

  return {
    data: data as unknown as LockDataV1,
    schemaVersion: 1,
    identityVerified: false,
    raw,
  };
}

export function deriveDaemonStatus(
  lock: ParsedLock | null,
  isAlive: (pid: number) => boolean,
): DaemonStatusResult {
  if (!lock) {
    return {
      status: "unknown",
      reason: "no_lock_file",
      heartbeatAgeMs: null,
      schemaVersion: 1,
      identityVerified: false,
    };
  }

  if (lock.schemaVersion === 1) {
    const alive = isAlive(lock.data.pid);
    return {
      status: alive ? "running" : "stopped",
      reason: alive ? "v1_signal_zero" : "v1_pid_dead",
      heartbeatAgeMs: null,
      schemaVersion: 1,
      identityVerified: false,
    };
  }

  const v2 = lock.data as LockDataV2;
  const heartbeatAgeMs = Date.now() - Date.parse(v2.heartbeat_at);

  if (v2.state === "errored") {
    return {
      status: "errored",
      reason: v2.last_error ?? "unknown_error",
      heartbeatAgeMs,
      schemaVersion: 2,
      identityVerified: true,
    };
  }

  if (!isAlive(v2.pid)) {
    return {
      status: "stopped",
      reason: "pid_dead",
      heartbeatAgeMs,
      schemaVersion: 2,
      identityVerified: true,
    };
  }

  if (heartbeatAgeMs >= STALE_THRESHOLD_MS) {
    return {
      status: "stale",
      reason: "heartbeat_stale",
      heartbeatAgeMs,
      schemaVersion: 2,
      identityVerified: true,
    };
  }

  return {
    status: "running",
    reason: "v2_identity_verified",
    heartbeatAgeMs,
    schemaVersion: 2,
    identityVerified: true,
  };
}
