---
phase: 3
plan: "03-A"
title: "Block Manual Integrate Handler"
wave: 1
depends_on: []
files_modified: ["lib/extensions/block-manual-integrate.ts", "lib/extensions/block-manual-integrate.test.mjs", "lib/extensions/tool-blockers.ts"]
requirements: ["GATE-03", "TEST-01", "TEST-02"]
autonomous: true
---

<objective>
Create `lib/extensions/block-manual-integrate.ts` as an InlineExtension tool_call handler that blocks `git cherry-pick`, `git merge`, and `gsd_impl_lane.py integrate` commands when `.autopilot.lock` contains a live PID. Export `commandStr` from `tool-blockers.ts` so both modules share the helper. Includes co-located tests covering block/allow paths and edge cases (stale lock, dead PID, missing lock, corrupt JSON).
</objective>

<tasks>
## Task 1: Export commandStr from tool-blockers.ts

<read_first>
- lib/extensions/tool-blockers.ts (lines 17-21 — commandStr and inputStr are module-level const, currently not exported)
</read_first>

<action>
Change `commandStr` and `inputStr` from `const` to `export const` in `lib/extensions/tool-blockers.ts`:

```typescript
// line 17 — change from:
const inputStr = (input: Record<string, unknown>, key: string): string =>
// to:
export const inputStr = (input: Record<string, unknown>, key: string): string =>

// line 20 — change from:
const commandStr = (input: Record<string, unknown>): string =>
// to:
export const commandStr = (input: Record<string, unknown>): string =>
```

No other changes needed — existing internal usages continue to work since `export const` is still accessible within the module.
</action>

<acceptance_criteria>
- `lib/extensions/tool-blockers.ts` contains `export const commandStr`
- `lib/extensions/tool-blockers.ts` contains `export const inputStr`
- Running `node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs` still passes (all 61 existing tests)
</acceptance_criteria>

## Task 2: Write test file (RED)

<read_first>
- lib/extensions/tool-blockers.test.mjs (reference for test structure with loadSubject + blocked/allowed helpers)
- lib/process-liveness.test.mjs (reference for loadSubject + jiti pattern)
</read_first>

<action>
Create `lib/extensions/block-manual-integrate.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import os from "os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./block-manual-integrate.ts");
  } catch { return import("./block-manual-integrate.ts"); }
}

function makeBashInput(cmd) {
  return { command: cmd };
}

describe("checkManualIntegrate", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-bmi-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("blocks git cherry-pick when lock has live PID", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git cherry-pick abc123"), tmpDir);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("daemon"), "reason should mention daemon");
  });

  test("blocks git merge when lock has live PID", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
  });

  test("blocks gsd_impl_lane.py integrate when lock has live PID", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("python gsd_impl_lane.py integrate --branch feat"), tmpDir);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
  });

  test("allows git merge-base (not a merge)", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git merge-base HEAD origin/main"), tmpDir);
    assert.equal(result, undefined, "should allow merge-base");
  });

  test("allows git merge when no lock file exists", async () => {
    const { checkManualIntegrate } = await loadSubject();
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.equal(result, undefined, "should allow when no lock");
  });

  test("allows git merge when lock has dead PID (fail open)", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: 99999999 }));
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.equal(result, undefined, "should allow when PID is dead");
  });

  test("allows non-Bash/PowerShell tools", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Read", { file_path: "foo.ts" }, tmpDir);
    assert.equal(result, undefined, "should allow non-shell tools");
  });

  test("allows Bash commands not matching integration patterns", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git status"), tmpDir);
    assert.equal(result, undefined, "should allow non-integration commands");
  });

  test("allows when lock file has corrupt JSON (fail open)", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), "not json{{{");
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.equal(result, undefined, "should allow on parse error");
  });
});
```
</action>

<acceptance_criteria>
- `lib/extensions/block-manual-integrate.test.mjs` exists
- File contains `async function loadSubject()`
- File contains `describe("checkManualIntegrate"`
- File contains at least 9 `test(` calls
- Running `node --experimental-strip-types --test lib/extensions/block-manual-integrate.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 3: Implement module (GREEN)

<read_first>
- lib/extensions/tool-blockers.ts (lines 20-21 — exported commandStr signature)
- lib/process-liveness.ts (isProcessAlive signature)
</read_first>

<action>
Create `lib/extensions/block-manual-integrate.ts`:

```typescript
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
```
</action>

<acceptance_criteria>
- `lib/extensions/block-manual-integrate.ts` exists
- File contains `export function checkManualIntegrate(`
- File imports `isProcessAlive` from `"../process-liveness"`
- File imports `commandStr` from `"./tool-blockers"`
- File contains `INTEGRATE_RE` regex with `cherry-pick`, `merge`, and `integrate` patterns
- `merge-base` is excluded via negative lookahead `(?!-base)`
- Running `node --experimental-strip-types --test lib/extensions/block-manual-integrate.test.mjs` passes all 9 tests
</acceptance_criteria>
</tasks>

<verification>
```bash
node --experimental-strip-types --test lib/extensions/block-manual-integrate.test.mjs
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs
```
Both must pass with 0 failures. tool-blockers.test.mjs verifies exporting commandStr didn't break existing rules.
</verification>

<must_haves>
- checkManualIntegrate function exported from block-manual-integrate.ts
- Blocks git cherry-pick, git merge, gsd_impl_lane.py integrate when .autopilot.lock has live PID
- Does NOT block git merge-base
- Fails open: missing lock, dead PID, corrupt JSON all → allow
- commandStr exported from tool-blockers.ts for shared use
- 9+ test cases covering block/allow/edge paths
</must_haves>
