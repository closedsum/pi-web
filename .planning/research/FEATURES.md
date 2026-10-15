# Features Research: 6 Orchestration Hooks

## Hook Behavior Catalog

### 1. ensure-lane-driver (145 lines)
**Type:** Daemon lifecycle manager (NOT a tool-call filter)
**Intercepts:** Nothing — runs at session start
**Block conditions:** N/A — ensures daemon is running, refuses to launch if:
- Project under temp dir or linked worktree
- No `.planning/config.json`
- Stop sentinel exists (`.planning/driver.stop`)
- Backoff (3 restarts in 60s)
- Lock held by live process
**Side effects:** Spawns `gsd_lane_driver.py run --detach`, writes lock/restart files
**Table stakes:** Must-have — driver is required for lane pipeline

### 2. fork-completion-gate (101 lines)
**Type:** Tool-call gate
**Intercepts:** `TaskUpdate` when `status === "completed"`
**Block conditions:** Blocks completion if fork result state file:
- Exists but has no `fork_result` field
- Lacks `## GSD-FORK-RESULT` header
- Status not in `{completed, complete, success, done}` (unless report-only)
- Missing commit SHA field
- Commit SHA not valid hex (7-40 chars)
**Side effects:** None (read-only)
**Table stakes:** Must-have — prevents incomplete forks from being marked done

### 3. block-probe-in-fork (72 lines)
**Type:** Tool-call gate
**Intercepts:** `Bash`, `PowerShell` when command contains `gsd_probe.py` or `gsd-probe`
**Block conditions:** Blocks if caller is a subagent (has `agent_id` or `agent_type`)
**Message:** "probes must run from the main session via PowerShell run_in_background, not from forks"
**Side effects:** None
**Table stakes:** Must-have — probes from forks break the orchestration model

### 4. audit-scope-guard (540 lines)
**Type:** File-operation proxy (NOT a tool-call filter)
**Intercepts:** Nothing directly — called by audit fixer agents instead of Write/Edit
**Block conditions:** Blocks file operations outside scope token:
- `OUT_OF_SCOPE` — target not in allowed set
- `CREATE_ONLY_TARGET` — writing to create-only target
- `TARGET_MISSING` — edit/write target doesn't exist
- Path traversal (`..`) blocked
- Symlink scope escapes blocked
**Side effects:** Writes files via atomic temp+rename
**Table stakes:** Must-have for audit safety — but deferred if audits don't run in pi-web yet

### 5. block-manual-integrate (121 lines)
**Type:** Tool-call gate
**Intercepts:** `Bash`, `PowerShell` — commands matching:
- `git cherry-pick`
- `git merge` (not `merge-base`)
- `gsd_impl_lane.py integrate[-hunks]`
**Block conditions:** Blocks if `.autopilot.lock` exists with live PID (proc_start match within 30s tolerance)
**Message:** "Auto-integration daemon is active. Use 'cancel --autopilot' to stop it first."
**Side effects:** None (read-only)
**Table stakes:** Must-have — prevents conflicting integration attempts

### 6. block-redispatch-without-fix (139 lines)
**Type:** Tool-call gate
**Intercepts:** `Bash`, `PowerShell` — commands containing `gsd_impl_lane.py pipeline --params-file`
**Block conditions:** Blocks redispatch if:
- Prior pipeline record exists with status `{failed, blocked, review_failed}`
- No commit on master touching WriteScope is newer than failure timestamp
**Message:** "pipeline slug previously failed; fix root cause and commit within WriteScope before redispatch"
**Side effects:** None (read-only)
**Table stakes:** Must-have — prevents wasting lanes on unfixed issues

## Dependencies Between Hooks

- **ensure-lane-driver** → independent (session-start)
- **fork-completion-gate** → needs state home resolution (shared with other hooks)
- **block-probe-in-fork** → needs subagent context (shared concern)
- **audit-scope-guard** → independent (separate extension)
- **block-manual-integrate** → needs process-liveness module + git repo root
- **block-redispatch-without-fix** → needs command parser + dispatch-status reader + git log

## Complexity Ranking

1. **audit-scope-guard** — 540 lines, full file-op proxy (most complex)
2. **ensure-lane-driver** — daemon lifecycle, spawn, locks (high)
3. **block-redispatch-without-fix** — command parsing + git + manifests (high)
4. **block-manual-integrate** — PID checks + git (medium-high)
5. **fork-completion-gate** — file read + regex parsing (medium)
6. **block-probe-in-fork** — pure string match + context check (low)
