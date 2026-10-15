---
phase: 03
phase_name: InlineExtension Hooks + Lane Driver
status: passed
verified: 2026-10-15
build_evidence: "npm run build exits 0; 117/117 tests pass (61 tool-blockers + 9 block-manual-integrate + 9 block-redispatch + 8 lane-driver-manager + 30 Phase 1)"
---

# Phase 03: InlineExtension Hooks + Lane Driver — Verification

## Goal Check

**Goal:** Port block-manual-integrate, block-redispatch-without-fix as InlineExtension tool_call handlers, and ensure-lane-driver as a session-start daemon manager.

### SC1: block-manual-integrate blocks cherry-pick/merge/integrate when .autopilot.lock has live PID
**PASS** — `lib/extensions/block-manual-integrate.ts` exports `checkManualIntegrate(toolName, input, cwd)`. Regex `INTEGRATE_RE` matches `git cherry-pick`, `git merge` (excluding `merge-base`), and `gsd_impl_lane.py integrate`. Reads `.autopilot.lock`, parses PID, calls `isProcessAlive()`. Returns block with reason when PID alive, undefined when dead/missing/corrupt. 9 test cases confirm block and allow paths.

### SC2: block-redispatch blocks pipeline when prior failed + no newer commit
**PASS** — `lib/extensions/block-redispatch.ts` exports `checkRedispatchWithoutFix(toolName, input, cwd, gitCheck)`. Matches `gsd_impl_lane.py pipeline`, extracts `--params-file` via `parseNamedArg`, reads manifest status from `.planning/impl-lanes/p-{slug}.json`. Blocks when status is in `FAILURE_STATUSES` set (`"failed"`, `"blocked"`, `"review_failed"`) and `gitLogLatestInScope` returns null (no newer commit). Injectable `gitCheck` parameter for testing. 9 test cases verify block/allow/fail-open paths.

### SC3: Lane driver checks daemon liveness and spawns for eligible projects
**PASS** — `lib/extensions/lane-driver-manager.ts` exports `ensureLaneDriver(cwd, stateHome, opts)`. Eligibility: has `.planning/config.json`, `.git` is a directory (not a file/worktree), not under tmpdir, no `driver.stop` sentinel. Checks `{hash}.lock` for live PID via `isDaemonAlive()`. Spawns detached Python process via injectable `spawner`. Writes lock file with PID and timestamp. 8 test cases.

### SC4: Lane driver respects backoff (3 restarts in 60s), lock file, stop sentinel
**PASS** — `BACKOFF_WINDOW_MS = 60_000`, `BACKOFF_MAX_RESTARTS = 3`. `isBackedOff()` reads `{hash}.backoff` JSON array, filters entries older than window, returns true when ≥3 recent. `recordRestart()` appends timestamp and prunes old. Stop sentinel: `isEligible()` checks `existsSync(path.join(cwd, ".planning", "driver.stop"))`. Lock file: `isDaemonAlive()` reads `{hash}.lock`, verifies PID alive. Tests cover backoff-skip, sentinel-skip, and corrupt-lock scenarios.

### SC5: Each hook has co-located tests with edge cases
**PASS** — Three test files:
- `block-manual-integrate.test.mjs` — 9 test cases (1 describe + 9 test): blocks cherry-pick/merge/integrate with live PID; allows with dead PID, missing lock, corrupt JSON, non-shell tool, merge-base
- `block-redispatch.test.mjs` — 9 test cases (1 describe + 9 test): blocks failed pipeline without fix; allows with newer commit, non-failure status, missing params-file, non-pipeline command
- `lane-driver-manager.test.mjs` — 8 test cases (1 describe + 8 test): spawns for eligible project; skips when alive, backed off, sentinel, worktree, tmpdir, no config, corrupt lock

## Requirement Coverage

| REQ-ID | Description | Status | Evidence |
|--------|-------------|--------|----------|
| GATE-03 | block-manual-integrate | ✓ | `lib/extensions/block-manual-integrate.ts` exports `checkManualIntegrate` |
| GATE-04 | block-redispatch-without-fix | ✓ | `lib/extensions/block-redispatch.ts` exports `checkRedispatchWithoutFix` |
| SVC-01 | ensure-lane-driver | ✓ | `lib/extensions/lane-driver-manager.ts` exports `ensureLaneDriver` |
| TEST-01 | Co-located tests | ✓ | All 3 modules have `.test.mjs` files alongside |
| TEST-02 | Block/allow test cases | ✓ | block-manual-integrate (3 block, 6 allow), block-redispatch (3 block, 4 allow, 2 fail-open) |

## Wiring Verification

`lib/extensions/index.ts` imports and wires all 3 handlers:
- Line 21: `import { checkManualIntegrate } from "./block-manual-integrate"`
- Line 22: `import { checkRedispatchWithoutFix } from "./block-redispatch"`
- Line 23: `import { ensureLaneDriver } from "./lane-driver-manager"`
- Line 65: `ensureLaneDriver(blockRuleCtx.cwd, blockRuleCtx.stateHome)` in session_start handler
- Lines 97-98: `checkManualIntegrate(...)` and `checkRedispatchWithoutFix(...)` chained in tool_call handler

## must_haves

- [x] block-manual-integrate blocks cherry-pick/merge/integrate when autopilot PID alive
- [x] block-redispatch blocks pipeline redispatch when prior failed and no fix committed
- [x] Lane driver spawns detached process for eligible projects
- [x] Backoff, lock file, and stop sentinel all functional
- [x] All handlers wired into GSD extension factory
- [x] 117/117 tests pass with zero regressions

## Deviations

- **03-C:** Tests used `tempDir: "/nonexistent-temp-sentinel"` to avoid os.tmpdir() collision (functionally sound)
- **03-C:** Tasks 1+2 merged into single commit (both part of same TDD cycle)
- No other deviations across 03-A, 03-B

## human_verification

None — all success criteria verified via automated tests and code inspection.
