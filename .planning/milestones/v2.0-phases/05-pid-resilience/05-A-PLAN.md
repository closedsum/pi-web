---
phase: 5
plan: A
title: Lock Schema v2 Types and Reader
wave: 1
depends_on: []
files_modified:
  - lib/lock-schema.ts
  - lib/lock-schema.test.mjs
autonomous: true
requirements: [PID-01, PID-03, TEST-01, TEST-02]
must_haves:
  - LockDataV2 TypeScript interface matches Python-side schema
  - parseLockFile reads both v1 and v2 formats
  - v1 locks return schema 1 with unverified identity
  - v2 locks return all identity fields
---

# Plan 05-A: Lock Schema v2 Types and Reader

## Objective

Define the v2 lock schema as TypeScript types and implement a lock file parser that handles both v1 (legacy `{pid, started_at}`) and v2 (`{schema, pid, proc_start, boot_id, instance_nonce, heartbeat_seq, heartbeat_at, state, last_error}`) formats with backward compatibility.

## Tasks

### Task 1: Define LockDataV2 interface and parseLockFile

<read_first>
- lib/extensions/lane-driver-manager.ts (current lock reading in isDaemonAlive, lock writing in ensureLaneDriver)
- lib/process-liveness.ts (current signal-zero check)
</read_first>

<action>
Create `lib/lock-schema.ts` with:

```typescript
export interface LockDataV1 {
  schema?: undefined;
  pid: number;
  started_at?: string;
}

export interface LockDataV2 {
  schema: 2;
  pid: number;
  proc_start: number;       // psutil create_time() epoch float
  boot_id: string;           // /proc/sys/kernel/random/boot_id or derived
  instance_nonce: string;    // UUID4 per daemon instance
  heartbeat_seq: number;     // monotonic counter from work loop
  heartbeat_at: string;      // ISO 8601 timestamp of last heartbeat
  state: "running" | "stopping" | "errored";
  last_error: string | null;
}

export type LockData = LockDataV1 | LockDataV2;

export interface ParsedLock {
  data: LockData;
  schemaVersion: 1 | 2;
  identityVerified: boolean; // false for v1 (no proc_start)
  raw: string;
}
```

Implement `parseLockFile(filePath: string): ParsedLock | null`:
- Read file, JSON.parse
- If `schema === 2`: validate required v2 fields, return `{data, schemaVersion: 2, identityVerified: true}`
- If no `schema` field: treat as v1, return `{data, schemaVersion: 1, identityVerified: false}`
- On parse error or missing file: return null
- Never throw — all errors result in null
</action>

<acceptance_criteria>
- `lib/lock-schema.ts` exports `LockDataV1`, `LockDataV2`, `LockData`, `ParsedLock`, `parseLockFile`
- `parseLockFile` given a v2 JSON file returns `schemaVersion: 2` and `identityVerified: true`
- `parseLockFile` given a v1 JSON file `{"pid":123,"started_at":"..."}` returns `schemaVersion: 1` and `identityVerified: false`
- `parseLockFile` given a nonexistent path returns `null`
- `parseLockFile` given malformed JSON returns `null`
</acceptance_criteria>

### Task 2: Derive daemon status from lock data

<read_first>
- lib/lock-schema.ts (just created in Task 1)
</read_first>

<action>
Add to `lib/lock-schema.ts`:

```typescript
export type DaemonStatus = "running" | "stopped" | "errored" | "stale" | "unknown";

export interface DaemonStatusResult {
  status: DaemonStatus;
  reason: string;
  heartbeatAgeMs: number | null;
  schemaVersion: 1 | 2;
  identityVerified: boolean;
}
```

Implement `deriveDaemonStatus(lock: ParsedLock | null, isAlive: (pid: number) => boolean): DaemonStatusResult`:
- null lock → `{status: "unknown", reason: "no_lock_file"}`
- v1 lock, PID alive → `{status: "running", reason: "v1_signal_zero", identityVerified: false}`
- v1 lock, PID dead → `{status: "stopped", reason: "v1_pid_dead", identityVerified: false}`
- v2 lock, state "errored" → `{status: "errored", reason: lock.last_error}`
- v2 lock, state "running", PID alive, heartbeat age < 15s → `{status: "running"}`
- v2 lock, state "running", heartbeat age >= 15s → `{status: "stale", reason: "heartbeat_stale"}`
- v2 lock, PID dead → `{status: "stopped", reason: "pid_dead"}`

Calculate `heartbeatAgeMs` as `Date.now() - Date.parse(lock.heartbeat_at)` for v2 locks, null for v1.
</action>

<acceptance_criteria>
- `deriveDaemonStatus(null, ...)` returns `{status: "unknown", reason: "no_lock_file"}`
- `deriveDaemonStatus(v1Lock, alwaysTrue)` returns `{status: "running", identityVerified: false}`
- `deriveDaemonStatus(v1Lock, alwaysFalse)` returns `{status: "stopped", identityVerified: false}`
- `deriveDaemonStatus(v2Lock_errored, ...)` returns `{status: "errored"}`
- `deriveDaemonStatus(v2Lock_staleHeartbeat, alwaysTrue)` returns `{status: "stale"}`
- All results include `schemaVersion` and `identityVerified` fields
</acceptance_criteria>

### Task 3: Co-located tests

<read_first>
- lib/lock-schema.ts (implementation)
- lib/extensions/tool-blockers.test.mjs (test patterns and jiti import)
</read_first>

<action>
Create `lib/lock-schema.test.mjs` using the project's test pattern:

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./lock-schema.ts");
  } catch { return import("./lock-schema.ts"); }
}
```

Test cases:
- parseLockFile with v2 JSON → schemaVersion 2, identityVerified true
- parseLockFile with v1 JSON → schemaVersion 1, identityVerified false
- parseLockFile with missing file → null
- parseLockFile with malformed JSON → null
- parseLockFile with v2 missing required field → null (invalid v2, don't fall through to v1)
- deriveDaemonStatus with null → unknown
- deriveDaemonStatus with v1 alive → running, unverified
- deriveDaemonStatus with v1 dead → stopped, unverified
- deriveDaemonStatus with v2 errored → errored
- deriveDaemonStatus with v2 stale heartbeat → stale
- deriveDaemonStatus with v2 running fresh → running, verified
- deriveDaemonStatus with v2 pid dead → stopped

Write test lock files to a temp directory, clean up in test teardown.
</action>

<acceptance_criteria>
- `lib/lock-schema.test.mjs` exists
- `node --experimental-strip-types --test lib/lock-schema.test.mjs` exits 0
- At least 12 test cases covering v1/v2 parsing and all status derivation paths
</acceptance_criteria>

## Verification

- [ ] `npm test` passes (all existing + new tests)
- [ ] `npm run build` succeeds
- [ ] Lock schema types exported correctly
- [ ] v1 backward compatibility verified (identityVerified: false)
- [ ] All 5 daemon status states reachable in tests
