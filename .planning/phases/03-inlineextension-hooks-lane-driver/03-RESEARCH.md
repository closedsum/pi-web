# Phase 3: InlineExtension Hooks + Lane Driver — Research

## InlineExtension Integration

### Extension Factory (index.ts)

The GSD extension factory at `lib/extensions/index.ts` is an `InlineExtension` with a `factory(pi)` method. Handlers register via `pi.on(event, handler)`:

- **`pi.on("tool_call", handler)`** — typed handler, returns `BlockResult | undefined`. Used by `evaluateBlockRules`. This is the typed path.
- **`(pi as any).on("session_start", handler)`** — cast needed because SDK doesn't expose `session_start` as typed event. Used for context capture (blockRuleCtx) and session lifecycle.
- **`(pi as any).on("session_shutdown", handler)`** — same cast pattern.

**Return values for tool_call:**
- `{ block: true, reason: string }` → blocks the tool call
- `undefined` → allows

**Key pattern:** The tool_call handler runs `evaluateBlockRules()` which iterates ALL_RULES. For Phase 3 InlineExtension hooks, we need a SEPARATE tool_call handler (not a BlockRule) because these hooks need async-capable logic, file I/O, and are fundamentally different from the sync pattern-matching BlockRules.

### How to add new tool_call handlers

Add another `pi.on("tool_call", handler)` block inside the factory. Multiple tool_call handlers fire in registration order. Each can return `BlockResult` to block or `undefined` to pass. If any handler blocks, the tool call is blocked.

### How to add session_start handlers

Use `(pi as any).on("session_start", handler)` inside the factory. Multiple session_start handlers are allowed.

## Source Hook Analysis

### block-manual-integrate (GATE-03)

**Original:** 121 lines, tool-call gate

**What it blocks:** `Bash`, `PowerShell` commands matching:
- `git cherry-pick`
- `git merge` (but NOT `git merge-base`)
- `gsd_impl_lane.py integrate` or `gsd_impl_lane.py integrate-hunks`

**Block condition:** `.autopilot.lock` exists AND contains a PID that is alive.
- Lock file format: JSON with `{ pid: number, proc_start?: string }`
- PID liveness: `process.kill(pid, 0)` — ESRCH = dead, EPERM = alive
- proc_start matching: within 30s tolerance (optional enhancement — not in pi-web scope)
- **Fail open:** No lock file → allow. Dead PID → allow. Parse error → allow.

**Message:** "Auto-integration daemon is active. Use 'cancel --autopilot' to stop it first."

**Pi-web implementation:**
- Separate module: `lib/extensions/block-manual-integrate.ts`
- Exports: `checkManualIntegrate(toolName: string, input: Record<string, unknown>, cwd: string): BlockResult | undefined`
- Uses: `isProcessAlive(pid)` from Phase 1, `readFileSync` for lock, `commandStr` helper pattern
- Lock path: `{cwd}/.autopilot.lock`

### block-redispatch-without-fix (GATE-04)

**Original:** 139 lines, tool-call gate

**What it blocks:** `Bash`, `PowerShell` commands containing `gsd_impl_lane.py pipeline --params-file`

**Block condition:** Prior pipeline record shows failure AND no newer commit in write scope on master.
1. Extract `--params-file` value from command via `parseNamedArg`
2. Read the params JSON file for `slug` and `write_scope` fields
3. Look for prior pipeline manifest at `{cwd}/.planning/impl-lanes/p-{slug}.json`
4. If manifest has `status` of `failed`, `blocked`, or `review_failed`:
   - Get the failure timestamp from the manifest
   - Check if any commit on master touches files matching `write_scope` globs after that timestamp
   - If no newer commit → **block** (fix not committed yet)
   - If newer commit exists → **allow** (fix might be in place)

**Fail open:** No params file → allow. No prior manifest → allow. Parse error → allow.

**Message:** "pipeline slug previously failed; fix root cause and commit within WriteScope before redispatch"

**Pi-web implementation:**
- Separate module: `lib/extensions/block-redispatch.ts`
- Exports: `checkRedispatchWithoutFix(toolName: string, input: Record<string, unknown>, cwd: string): BlockResult | undefined`
- Uses: `parseNamedArg` (Phase 1), `gitLogLatestInScope` (Phase 1), `readFileSync`
- Read params file, read manifest, compare timestamps, check git log

### ensure-lane-driver (SVC-01)

**Original:** 145 lines, daemon lifecycle manager

**Trigger:** session_start event (not tool_call)

**Eligibility checks (all must pass):**
1. `cwd` has `.planning/config.json` (is a GSD project)
2. Not a git worktree (check `git rev-parse --is-inside-work-tree` + `git worktree list`)
3. Not under temp dir (cwd doesn't start with OS temp path)
4. No stop sentinel at `.planning/driver.stop`

**Daemon liveness check:**
1. Read `{stateHome}/lane-driver/{project-hash}.lock` for PID
2. Check `isProcessAlive(pid)` — if alive, done (daemon running)
3. If dead or no lock → spawn

**Spawn:**
- `spawn("python", ["gsd_lane_driver.py", "run", "--detach"], { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true })`
- Write PID to lock file
- Unref child (let it survive parent)

**Backoff:** Track restart timestamps. If 3+ restarts in last 60s → refuse to spawn, log warning.

**Lock file:** `{stateHome}/lane-driver/{hash}.lock` — JSON with `{ pid, started_at }`

**Pi-web implementation:**
- Separate module: `lib/extensions/lane-driver-manager.ts`
- Exports: `ensureLaneDriver(cwd: string, stateHome: string): void`
- Uses: `isProcessAlive` (Phase 1), `resolveStateHome` (Phase 1), `spawn` from `child_process`
- Called from `session_start` handler in index.ts

## Module Design

### lib/extensions/block-manual-integrate.ts
- Pure function: `checkManualIntegrate(toolName, input, cwd) → BlockResult | undefined`
- Helpers: `commandStr` reuse from tool-blockers pattern (or import it)
- File I/O: `readFileSync` for `.autopilot.lock`
- Dependency: `isProcessAlive` from `../process-liveness`

### lib/extensions/block-redispatch.ts
- Pure function: `checkRedispatchWithoutFix(toolName, input, cwd) → BlockResult | undefined`
- Dependency: `parseNamedArg` from `../shell-command-parser`
- Dependency: `gitLogLatestInScope` from `../git-query`
- File I/O: `readFileSync` for params file + pipeline manifest

### lib/extensions/lane-driver-manager.ts
- Side-effectful: `ensureLaneDriver(cwd, stateHome) → void`
- Dependency: `isProcessAlive` from `../process-liveness`
- Dependency: `spawn` from `child_process`
- File I/O: `readFileSync`/`writeFileSync` for lock, `existsSync` for sentinel
- State: backoff tracking via in-memory timestamp array + stateHome file

### Integration in index.ts
```typescript
import { checkManualIntegrate } from "./block-manual-integrate";
import { checkRedispatchWithoutFix } from "./block-redispatch";
import { ensureLaneDriver } from "./lane-driver-manager";

// In factory(pi):
// 1. session_start: call ensureLaneDriver(cwd, stateHome)
// 2. New tool_call handler for InlineExtension gates:
pi.on("tool_call", (ev) => {
  const cwd = blockRuleCtx?.cwd ?? process.cwd();
  return checkManualIntegrate(ev.toolName, ev.input ?? {}, cwd)
      ?? checkRedispatchWithoutFix(ev.toolName, ev.input ?? {}, cwd);
});
```

## Test Strategy

### Unit tests (co-located .test.mjs files)

**block-manual-integrate.test.mjs:**
- Block: git cherry-pick when lock has live PID → blocked
- Block: git merge when lock has live PID → blocked
- Block: gsd_impl_lane.py integrate when lock has live PID → blocked
- Allow: git merge-base (not merge) → allowed
- Allow: git merge when no lock file → allowed
- Allow: git merge when lock has dead PID → allowed (fail open)
- Allow: non-Bash/PowerShell tool → allowed
- Allow: Bash command not matching patterns → allowed
- Edge: corrupt lock JSON → allowed (fail open)

**block-redispatch.test.mjs:**
- Block: redispatch when prior failed, no newer commit → blocked
- Allow: redispatch when prior failed but newer commit exists → allowed
- Allow: no prior manifest → allowed (first dispatch)
- Allow: prior succeeded → allowed
- Allow: command doesn't contain gsd_impl_lane.py pipeline → allowed
- Edge: params file missing → allowed (fail open)
- Edge: manifest missing status field → allowed

**lane-driver-manager.test.mjs:**
- Spawn: eligible project, no lock → spawns
- Skip: daemon alive (lock with live PID) → no spawn
- Spawn: daemon dead (lock with dead PID) → re-spawns
- Skip: not a GSD project (no .planning/config.json) → no spawn
- Skip: worktree project → no spawn
- Skip: temp dir project → no spawn
- Skip: stop sentinel exists → no spawn
- Skip: backoff (3 restarts in 60s) → no spawn
- Edge: lock parse error → treats as dead

**Testing approach:**
- Use temp directories with mock file structures (lock files, manifests, params files)
- Mock `isProcessAlive` via parameter injection (pass a checker function)
- Mock `spawn` for lane-driver-manager (verify call args without actually spawning)
- Use the existing `loadSubject()` + jiti pattern from Phase 1/2

### Important: commandStr helper

The `commandStr` helper in tool-blockers.ts is a module-level `const` function (not exported). The new InlineExtension modules need the same logic. Options:
1. Export `commandStr` from tool-blockers.ts (minimal change, shares code)
2. Duplicate in each module (violates DRY but avoids coupling)
3. Extract to a shared utility

**Recommendation:** Export `commandStr` from tool-blockers.ts — it's already a shared pattern and Phase 3 modules are in the same `lib/extensions/` directory.

## Pitfalls & Edge Cases

1. **Sync I/O in tool_call handlers:** `readFileSync` for lock files and manifests is blocking but acceptable — these files are small (<1KB) and reads complete in <1ms. Log timing to catch regressions.

2. **Multiple tool_call handlers:** The new InlineExtension tool_call handler runs AFTER the BlockRule handler. If BlockRules already blocked, the InlineExtension handler still fires (wasted work). Could optimize by checking if already blocked, but not worth the complexity.

3. **Daemon spawn race:** Two sessions could both try to spawn the lane driver simultaneously. Mitigate with lock file atomicity: `writeFileSync` with exclusive flag or `proper-lockfile` if available.

4. **Lock file cleanup:** If pi-web server crashes, lock files persist with dead PIDs. All handlers already handle this (check PID liveness → dead PID = stale lock → fail open or re-spawn).

5. **Path resolution:** `.autopilot.lock` is relative to `cwd`. Pipeline manifests are at `{cwd}/.planning/impl-lanes/p-{slug}.json`. Use `path.join` consistently.

6. **git merge vs git merge-base:** The regex for `git merge` must NOT match `git merge-base`. Use word boundary: `/\bgit\s+merge\b(?!-base)/` or similar.
