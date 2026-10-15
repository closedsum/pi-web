---
phase: 3
plan: "03-C"
title: "Lane Driver Manager + Extension Wiring"
wave: 2
depends_on: ["03-A", "03-B"]
files_modified: ["lib/extensions/lane-driver-manager.ts", "lib/extensions/lane-driver-manager.test.mjs", "lib/extensions/index.ts"]
requirements: ["SVC-01", "TEST-01"]
autonomous: true
---

<objective>
Create `lib/extensions/lane-driver-manager.ts` as a session-start handler that checks daemon liveness and spawns `gsd_lane_driver.py run --detach` for eligible projects. Implements backoff (3 restarts in 60s), lock file management, and stop sentinel support. Then wire all three Phase 3 handlers (checkManualIntegrate, checkRedispatchWithoutFix, ensureLaneDriver) into `lib/extensions/index.ts`.
</objective>

<tasks>
## Task 1: Write test file (RED)

<read_first>
- lib/extensions/block-manual-integrate.test.mjs (reference for temp dir test pattern with beforeEach/afterEach)
- lib/process-liveness.ts (isProcessAlive signature)
- lib/state-home.ts (resolveStateHome signature)
</read_first>

<action>
Create `lib/extensions/lane-driver-manager.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import os from "os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./lane-driver-manager.ts");
  } catch { return import("./lane-driver-manager.ts"); }
}

describe("ensureLaneDriver", () => {
  let tmpDir;
  let stateDir;
  let spawnCalls;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ldm-"));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ldm-state-"));
    spawnCalls = [];
    // Create .planning/config.json so project is eligible
    fs.mkdirSync(path.join(tmpDir, ".planning"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".planning", "config.json"), "{}");
    // Create .git so it looks like a repo (not a worktree)
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function mockSpawner(pid) {
    return (...args) => {
      spawnCalls.push(args);
      return { pid, unref() {} };
    };
  }

  function mockAlive(alivePids) {
    return (pid) => alivePids.includes(pid);
  }

  test("spawns daemon for eligible project with no lock", async () => {
    const { ensureLaneDriver } = await loadSubject();
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
    });
    assert.equal(spawnCalls.length, 1, "should spawn once");
    assert.ok(spawnCalls[0][1].includes("run"), "should pass 'run' arg");
  });

  test("skips spawn when daemon already alive", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({ pid: 42 }));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(100),
      aliveCheck: mockAlive([42]),
    });
    assert.equal(spawnCalls.length, 0, "should not spawn when alive");
  });

  test("respawns when daemon dead (lock with dead PID)", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({ pid: 99999999 }));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
    });
    assert.equal(spawnCalls.length, 1, "should respawn when dead");
  });

  test("skips when not a GSD project (no .planning/config.json)", async () => {
    const { ensureLaneDriver } = await loadSubject();
    fs.rmSync(path.join(tmpDir, ".planning", "config.json"));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
    });
    assert.equal(spawnCalls.length, 0, "should not spawn without config.json");
  });

  test("skips when project is under temp dir", async () => {
    const { ensureLaneDriver } = await loadSubject();
    // tmpDir is already under os.tmpdir() — eligible check should catch it
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: path.dirname(tmpDir),
    });
    assert.equal(spawnCalls.length, 0, "should not spawn in temp dir");
  });

  test("skips when stop sentinel exists", async () => {
    const { ensureLaneDriver } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".planning", "driver.stop"), "");
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
    });
    assert.equal(spawnCalls.length, 0, "should not spawn with stop sentinel");
  });

  test("skips when backoff triggered (3 restarts in 60s)", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    // Write a backoff log with 3 recent restarts
    const now = Date.now();
    const backoffLog = [now - 30000, now - 20000, now - 10000];
    fs.writeFileSync(path.join(lockDir, `${hash}.backoff`), JSON.stringify(backoffLog));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
    });
    assert.equal(spawnCalls.length, 0, "should not spawn during backoff");
  });

  test("allows when lock file has corrupt JSON (treats as dead)", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), "not json{{{");
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
    });
    assert.equal(spawnCalls.length, 1, "should spawn when lock is corrupt");
  });
});
```
</action>

<acceptance_criteria>
- `lib/extensions/lane-driver-manager.test.mjs` exists
- File contains `async function loadSubject()`
- File contains `describe("ensureLaneDriver"`
- File contains at least 8 `test(` calls
- Tests cover spawn, skip-alive, respawn-dead, skip-no-config, skip-temp-dir, skip-sentinel, skip-backoff, corrupt-lock
- Running `node --experimental-strip-types --test lib/extensions/lane-driver-manager.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 2: Implement lane-driver-manager module (GREEN)

<read_first>
- lib/process-liveness.ts (isProcessAlive signature)
- lib/extensions/session-lifecycle.ts (existing session-start handler patterns)
- lib/extensions/index.ts (how session_start handlers are wired)
</read_first>

<action>
Create `lib/extensions/lane-driver-manager.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { createHash } from "crypto";
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
  const tmpBase = tempDir ?? require("os").tmpdir();
  if (resolved.startsWith(tmpBase)) return false;
  // Worktree check: .git is a file (not dir) in worktrees
  const dotGit = path.join(cwd, ".git");
  try {
    const stat = require("fs").statSync(dotGit);
    if (stat.isFile()) return false; // worktree — .git is a file pointing to main repo
  } catch {
    return false; // no .git at all
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

  const spawner = opts.spawner;
  if (!spawner) {
    // Production path: use child_process.spawn
    const { spawn } = require("child_process");
    const child = spawn("python", [
      path.join(process.env.HOME ?? "", ".claude", "get-shit-done", "bin", "gsd_lane_driver.py"),
      "run", "--detach",
    ], {
      cwd,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    const dir = path.join(stateHome, "lane-driver");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${hash}.lock`), JSON.stringify({ pid: child.pid, started_at: new Date().toISOString() }));
    child.unref();
  } else {
    const child = spawner("python", [
      "gsd_lane_driver.py", "run", "--detach",
    ], { cwd, detached: true });
    const dir = path.join(stateHome, "lane-driver");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${hash}.lock`), JSON.stringify({ pid: child.pid, started_at: new Date().toISOString() }));
    child.unref();
  }

  recordRestart(stateHome, hash);
}
```
</action>

<acceptance_criteria>
- `lib/extensions/lane-driver-manager.ts` exists
- File contains `export function ensureLaneDriver(`
- File contains `export function projectHash(`
- File contains `BACKOFF_WINDOW_MS = 60_000` and `BACKOFF_MAX_RESTARTS = 3`
- File checks: config.json exists, not a worktree, not temp dir, no stop sentinel
- File has backoff tracking via `.backoff` file
- Running `node --experimental-strip-types --test lib/extensions/lane-driver-manager.test.mjs` passes all 8 tests
</acceptance_criteria>

## Task 3: Wire all Phase 3 handlers into index.ts

<read_first>
- lib/extensions/index.ts (current factory structure, existing tool_call and session_start handlers)
- lib/extensions/block-manual-integrate.ts (checkManualIntegrate export)
- lib/extensions/block-redispatch.ts (checkRedispatchWithoutFix export)
</read_first>

<action>
Edit `lib/extensions/index.ts`:

1. Add imports at top (after existing imports):
```typescript
import { checkManualIntegrate } from "./block-manual-integrate";
import { checkRedispatchWithoutFix } from "./block-redispatch";
import { ensureLaneDriver } from "./lane-driver-manager";
```

2. Inside the `factory(pi)` function, add a new tool_call handler AFTER the existing evaluateBlockRules handler:
```typescript
      // Phase 3: InlineExtension gate handlers
      pi.on("tool_call", (ev: ToolCallEvent) => {
        const start = performance.now();
        const cwd = blockRuleCtx?.cwd ?? process.cwd();
        const result = checkManualIntegrate(ev.toolName, ev.input ?? {}, cwd)
                    ?? checkRedispatchWithoutFix(ev.toolName, ev.input ?? {}, cwd);
        const durationMs = performance.now() - start;
        if (onTiming) {
          onTiming({ event: "tool_call", handlerName: "inline-gates", durationMs, blocked: result?.block ?? false, timestamp: Date.now() });
        }
        return result;
      });
```

3. Inside the existing `session_start` handler (the one at line ~54), add lane driver check after blockRuleCtx assignment:
```typescript
        // Phase 3: Lane driver daemon management
        try {
          ensureLaneDriver(blockRuleCtx.cwd, blockRuleCtx.stateHome);
        } catch {
          // Lane driver spawn failure is non-fatal — log but don't block session
        }
```
</action>

<acceptance_criteria>
- `lib/extensions/index.ts` imports `checkManualIntegrate` from `"./block-manual-integrate"`
- `lib/extensions/index.ts` imports `checkRedispatchWithoutFix` from `"./block-redispatch"`
- `lib/extensions/index.ts` imports `ensureLaneDriver` from `"./lane-driver-manager"`
- File contains `checkManualIntegrate(ev.toolName`
- File contains `ensureLaneDriver(blockRuleCtx.cwd`
- `npm run build` exits 0
- Running `node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs` still passes (existing tests unchanged)
</acceptance_criteria>
</tasks>

<verification>
```bash
node --experimental-strip-types --test lib/extensions/lane-driver-manager.test.mjs
node --experimental-strip-types --test lib/extensions/block-manual-integrate.test.mjs
node --experimental-strip-types --test lib/extensions/block-redispatch.test.mjs
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs
npm run build
```
All must pass with 0 failures. Build must exit 0.
</verification>

<must_haves>
- ensureLaneDriver function with eligibility checks (config.json, not worktree, not temp, no sentinel)
- Backoff: 3 restarts in 60s → refuses to spawn
- Lock file management with PID tracking
- Spawner and aliveCheck injectable for testing
- All 3 Phase 3 handlers wired into index.ts
- Lane driver spawn failure is non-fatal (try/catch)
- 8+ test cases covering spawn/skip scenarios
</must_haves>
