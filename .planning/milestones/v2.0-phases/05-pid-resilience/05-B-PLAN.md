---
phase: 5
plan: B
title: Integrate Lock Schema v2 into Lane Driver Manager
wave: 2
depends_on: [05-A]
files_modified:
  - lib/extensions/lane-driver-manager.ts
  - lib/extensions/lane-driver-manager.test.mjs
  - lib/extensions/block-manual-integrate.ts
autonomous: true
requirements: [PID-02, PID-03, PID-04, TEST-01, TEST-02]
must_haves:
  - isDaemonAlive uses parseLockFile and deriveDaemonStatus
  - ensureLaneDriver writes v2-compatible lock data
  - block-manual-integrate uses identity-aware liveness
  - Existing tests still pass (backward compat)
---

# Plan 05-B: Integrate Lock Schema v2 into Lane Driver Manager

## Objective

Replace the inline lock file reading in `lane-driver-manager.ts` and `block-manual-integrate.ts` with the structured `parseLockFile` / `deriveDaemonStatus` from `lock-schema.ts`. Update lock writing to include the fields Node.js can populate (pid, started_at) while leaving identity fields for the Python daemon to fill via heartbeat.

## Tasks

### Task 1: Refactor isDaemonAlive to use lock-schema

<read_first>
- lib/extensions/lane-driver-manager.ts (current isDaemonAlive function at line ~61)
- lib/lock-schema.ts (parseLockFile, deriveDaemonStatus)
</read_first>

<action>
In `lane-driver-manager.ts`:

1. Import `parseLockFile`, `deriveDaemonStatus` from `../lock-schema`
2. Replace `isDaemonAlive` implementation:

```typescript
function isDaemonAlive(stateHome: string, hash: string, aliveCheck: (pid: number) => boolean): boolean {
  const lockPath = path.join(stateHome, "lane-driver", `${hash}.lock`);
  const lock = parseLockFile(lockPath);
  if (!lock) return false;
  const status = deriveDaemonStatus(lock, aliveCheck);
  return status.status === "running";
}
```

3. Export a new `getDaemonStatus` function for Phase 6 (Status UI) to consume:

```typescript
export function getDaemonStatus(stateHome: string, hash: string, aliveCheck?: (pid: number) => boolean): DaemonStatusResult {
  const lockPath = path.join(stateHome, "lane-driver", `${hash}.lock`);
  const lock = parseLockFile(lockPath);
  return deriveDaemonStatus(lock, aliveCheck ?? isProcessAlive);
}
```

4. The lock WRITING in ensureLaneDriver stays as `{pid, started_at}` (v1 format) because Node spawns the daemon — the daemon itself will overwrite with v2 format via its first heartbeat. This is the designed upgrade path: Node writes v1 bootstrap lock → Python daemon overwrites with v2.
</action>

<acceptance_criteria>
- `isDaemonAlive` uses `parseLockFile` + `deriveDaemonStatus` instead of inline JSON.parse
- `getDaemonStatus` is exported from `lane-driver-manager.ts`
- `getDaemonStatus` returns `DaemonStatusResult` type
- Existing `ensureLaneDriver` tests pass unchanged (backward compat)
</acceptance_criteria>

### Task 2: Update block-manual-integrate to use identity-aware check

<read_first>
- lib/extensions/block-manual-integrate.ts (current autopilot lock check)
- lib/lock-schema.ts (parseLockFile, deriveDaemonStatus)
</read_first>

<action>
In `block-manual-integrate.ts`:

Find the autopilot lock check (reads `.autopilot.lock` and checks PID liveness). Update to use `parseLockFile` for the autopilot lock file as well:

1. Import `parseLockFile`, `deriveDaemonStatus` from `../lock-schema`
2. Replace the inline lock reading with `parseLockFile`
3. Use `deriveDaemonStatus` to determine if the autopilot daemon is alive
4. When status is "running" → block the integration command
5. When status is "unverified" (v1 lock) → still block (fail-closed) but include "unverified" in the block reason
</action>

<acceptance_criteria>
- `block-manual-integrate.ts` imports from `../lock-schema`
- Autopilot lock check uses `parseLockFile` + `deriveDaemonStatus`
- v1 locks still trigger blocking (fail-closed)
- Block reason includes "unverified" when lock is v1 schema
- Existing block-manual-integrate tests pass
</acceptance_criteria>

### Task 3: Update and extend tests

<read_first>
- lib/extensions/lane-driver-manager.test.mjs (existing tests)
- lib/extensions/block-manual-integrate.test.mjs (existing tests)
</read_first>

<action>
Update existing test files:

1. `lane-driver-manager.test.mjs`:
   - Add test: `isDaemonAlive` returns true for v2 lock with running state and alive PID
   - Add test: `isDaemonAlive` returns false for v2 lock with stale heartbeat
   - Add test: `isDaemonAlive` returns true for v1 lock with alive PID (backward compat)
   - Add test: `getDaemonStatus` returns full status object with schema version
   - Add test: `getDaemonStatus` with no lock file returns unknown

2. `block-manual-integrate.test.mjs`:
   - Add test: blocks with v2 running lock
   - Add test: blocks with v1 lock (fail-closed, unverified)
   - Add test: allows with v2 stopped lock
</action>

<acceptance_criteria>
- `node --experimental-strip-types --test lib/extensions/lane-driver-manager.test.mjs` exits 0
- `node --experimental-strip-types --test lib/extensions/block-manual-integrate.test.mjs` exits 0
- New tests cover v1 and v2 lock scenarios in both modules
- At least 5 new test cases added across both files
</acceptance_criteria>

## Verification

- [ ] `npm test` passes (all existing + new tests)
- [ ] `npm run build` succeeds
- [ ] No inline JSON.parse of lock files remains in lane-driver-manager.ts
- [ ] block-manual-integrate uses structured lock reader
- [ ] v1 locks still work (backward compatibility)
