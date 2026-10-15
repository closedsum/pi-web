# Roadmap: Pi Web — Orchestration Hook Porting

## Milestone: v1 — Orchestration Parity

**Phases:** 4
**Requirements:** 16 v1 requirements
**Coverage:** 100% — all v1 requirements mapped

---

### Phase 1: Foundation Infrastructure

**Goal:** Create shared utility modules that the infrastructure-dependent hooks will consume — state-home resolver, process-liveness checker, git-query wrapper, and shell-command parser.

**Requirements:** INFRA-01, INFRA-02, INFRA-03, INFRA-04, TEST-01, TEST-03, TEST-04

**Success Criteria:**
1. `resolveStateHome()` returns a valid directory path from `GSD_STATE_HOME` or falls back to `~/.gsd`
2. `isProcessAlive(pid)` returns true for the current process PID and false for a known-dead PID
3. `gitRevParseShowToplevel(cwd)` returns the repo root, and `gitLogLatestInScope(repo, branch, globs)` returns an ISO timestamp or null — both complete within 50ms on the pi-web repo
4. `parseNamedArg(command, argName)` extracts `--params-file /path/to/file` from a representative dispatch command string
5. Each module has a co-located `.test.mjs` with edge cases (ESRCH, EPERM, missing env var, timeout, malformed commands)

**Depends On:** Nothing (foundation phase)

**UI hint:** no

---

### Phase 2: BlockRule Context + Simple Gates

**Goal:** Extend the BlockRule type with an optional context parameter, then port block-probe-in-fork and fork-completion-gate as context-aware BlockRules.

**Requirements:** CTX-01, CTX-02, CTX-03, GATE-01, GATE-02, TEST-02

**Success Criteria:**
1. `BlockRule.test` accepts an optional third parameter `ctx?: BlockRuleContext` with `{ cwd, isSubagent, sessionId, stateHome }`
2. All 21 existing rules pass their existing tests unchanged (backward compatibility)
3. `block-probe-in-fork` blocks Bash/PowerShell calls containing `gsd_probe.py` when `ctx.isSubagent === true`, and allows them when `ctx.isSubagent === false`
4. `fork-completion-gate` blocks `TaskUpdate(completed)` when the fork-result state file at `{ctx.stateHome}/fork-results/{taskId}.json` is missing, malformed, or lacks a valid commit SHA
5. Each new rule has allow/block test cases using the existing `_test-harness.mjs` (`assertBlocks`, `assertAllows`)

**Depends On:** Phase 1 (state-home resolver for fork-completion-gate)

**UI hint:** no

---

### Phase 3: InlineExtension Hooks + Lane Driver

**Goal:** Port block-manual-integrate, block-redispatch-without-fix as InlineExtension tool_call handlers, and ensure-lane-driver as a session-start daemon manager.

**Requirements:** GATE-03, GATE-04, SVC-01, TEST-01, TEST-02

**Success Criteria:**
1. `block-manual-integrate` blocks `git cherry-pick`, `git merge`, and `gsd_impl_lane.py integrate` commands when `.autopilot.lock` contains a live PID — verified by a test with a mocked PID check
2. `block-redispatch-without-fix` blocks `gsd_impl_lane.py pipeline --params-file` when the prior pipeline record shows `failed`/`blocked`/`review_failed` and no newer commit exists in the write scope on master
3. Lane driver manager checks daemon liveness at session start and spawns `gsd_lane_driver.py run --detach` for eligible projects (has `.planning/config.json`, not a worktree, not under temp dir)
4. Lane driver manager respects backoff (3 restarts in 60s), lock file ownership, and stop sentinel
5. Each hook has co-located tests covering block/allow paths and edge cases (stale lock, dead PID, missing manifest)

**Depends On:** Phase 1 (process-liveness, git-query, shell-command-parser), Phase 2 (for consistency with block rule testing patterns)

**UI hint:** no

---

### Phase 4: Audit Scope Extension

**Goal:** Port audit-scope-guard as a file-operation proxy InlineExtension that intercepts Write/Edit/Delete from audit sessions and enforces scope boundaries via scope tokens.

**Requirements:** SVC-02

**Success Criteria:**
1. When an audit session calls Write/Edit targeting a file outside the scope token, the call is blocked with an `OUT_OF_SCOPE` reason
2. Path traversal attempts (`..`) and symlink scope escapes are detected and blocked
3. Legitimate writes within scope succeed with atomic temp-file-then-rename semantics

**Depends On:** Phase 1 (state-home), Phase 3 (InlineExtension pattern established)

**UI hint:** no

---

## Phase Summary

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | Foundation Infrastructure | Shared utility modules | INFRA-01..04, TEST-01,03,04 | 5 |
| 2 | BlockRule Context + Simple Gates | Extend type, port 2 simple rules | CTX-01..03, GATE-01,02, TEST-02 | 5 |
| 3 | InlineExtension Hooks + Lane Driver | Port 2 complex rules + daemon manager | GATE-03,04, SVC-01, TEST-01,02 | 5 |
| 4 | Audit Scope Extension | File-op proxy for audits | SVC-02 | 3 |

---
*Roadmap created: 2026-10-15*
*Last updated: 2026-10-15 after initialization*
