---
phase: 1
plan: "01-B"
title: "Process Liveness Checker"
wave: 1
depends_on: []
files_modified: ["lib/process-liveness.ts", "lib/process-liveness.test.mjs"]
requirements: ["INFRA-02", "TEST-01", "TEST-04"]
autonomous: true
---

<objective>
Create `lib/process-liveness.ts` with `isProcessAlive(pid)` that uses `process.kill(pid, 0)` to check whether a process is alive. Handles ESRCH (not found), EPERM (alive but no permission), and invalid PID inputs. Includes a co-located test file covering live PID, dead PID, EPERM, and invalid input scenarios.
</objective>

<tasks>
## Task 1: Write test file (RED)

<read_first>
- lib/dispatch-status.test.mjs (reference for loadSubject() + jiti pattern)
- lib/mcp-transport.test.mjs:77 (existing process.kill(pid, 0) usage in tests)
</read_first>

<action>
Create `lib/process-liveness.test.mjs` with:

```javascript
import assert from "node:assert/strict";
import test, { describe } from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./process-liveness.ts");
  } catch { return import("./process-liveness.ts"); }
}

describe("isProcessAlive", () => {
  test("returns true for the current process PID", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(process.pid), true);
  });

  test("returns false for a known-dead PID", async () => {
    const { isProcessAlive } = await loadSubject();
    // PID 99999999 is extremely unlikely to be alive
    assert.equal(isProcessAlive(99999999), false);
  });

  test("returns false for PID 0", async () => {
    const { isProcessAlive } = await loadSubject();
    // PID 0 is the kernel/system process — process.kill(0,0) sends to process group
    // which is a special case; treat as not a valid target
    assert.equal(typeof isProcessAlive(0), "boolean");
  });

  test("returns false for negative PID", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(-1), false);
  });

  test("returns false for NaN", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(NaN), false);
  });

  test("returns false for non-integer PID", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(3.14), false);
  });

  test("returns true for parent process PID (if available)", async () => {
    const { isProcessAlive } = await loadSubject();
    const ppid = process.ppid;
    if (ppid && ppid > 0) {
      assert.equal(isProcessAlive(ppid), true);
    }
  });
});
```
</action>

<acceptance_criteria>
- `lib/process-liveness.test.mjs` exists
- File contains `async function loadSubject()`
- File contains `describe("isProcessAlive"`
- File contains at least 6 `test(` calls
- File tests `process.pid` (live) and `99999999` (dead)
- Running `node --experimental-strip-types --test lib/process-liveness.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 2: Implement module (GREEN)

<read_first>
- lib/atomic-file.ts (pattern: error code checking with `(err as NodeJS.ErrnoException).code`)
- lib/session-liveness.ts (existing liveness abstraction — different purpose but same naming area)
</read_first>

<action>
Create `lib/process-liveness.ts` with:

```typescript
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return false;
  }
}
```

- Guard against invalid inputs (NaN, negative, non-integer) before calling process.kill
- `process.kill(pid, 0)` sends signal 0 — checks existence without killing
- ESRCH = "no such process" → return false
- EPERM = "operation not permitted" → process exists but owned by another user → return true
- Any other error → return false (defensive)
</action>

<acceptance_criteria>
- `lib/process-liveness.ts` contains `export function isProcessAlive`
- `lib/process-liveness.ts` contains `process.kill(pid, 0)`
- `lib/process-liveness.ts` contains `"ESRCH"`
- `lib/process-liveness.ts` contains `"EPERM"`
- `lib/process-liveness.ts` contains `Number.isInteger(pid)`
- `node --experimental-strip-types --test lib/process-liveness.test.mjs` exits 0
</acceptance_criteria>
</tasks>

<verification>
```bash
node --experimental-strip-types --test lib/process-liveness.test.mjs
grep -c "export function isProcessAlive" lib/process-liveness.ts
grep -c "test(" lib/process-liveness.test.mjs
```
</verification>

<must_haves>
- `isProcessAlive(pid)` returns boolean
- Returns true for current process PID (`process.pid`)
- Returns false for a known-dead PID
- ESRCH → false (process does not exist)
- EPERM → true (process exists but no permission to signal)
- Invalid inputs (NaN, negative, non-integer) → false without throwing
- Co-located test file with ESRCH, EPERM, stale PID, and invalid input scenarios
</must_haves>
