# Phase 5: PID Resilience - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning
**Mode:** Infrastructure phase — skipping discuss

<domain>
## Phase Boundary

Upgrade the lane driver lock schema to include process identity (start time, boot ID, nonce) so PID reuse cannot cause false liveness or stale-lock adoption. Python-side implementation per "Python-first" rule.

Requirements: PID-01, PID-02, PID-03, PID-04, TEST-01, TEST-02

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and research findings to guide decisions.

Key research guidance:
- Use `psutil.Process(pid).create_time()` for process identity (fallback: `ctypes` + `GetProcessTimes`)
- Lock schema v2: `{schema:2, pid, proc_start, boot_id, instance_nonce, heartbeat_seq, heartbeat_at, state, last_error}`
- Atomic writes via `os.replace` (temp file + rename)
- Boot ID: `/proc/sys/kernel/random/boot_id` on Linux, `Date.now() - os.uptime()*1000` fallback
- No PID signal without identity match
- Heartbeat from work loop, not separate thread
- macOS: ±1s tolerance for proc_start comparison

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/process-liveness.ts` — existing signal-zero PID check (v1.0)
- `lib/state-home.ts` — resolves GSD_STATE_HOME path
- `lib/extensions/lane-driver-manager.ts` — manages daemon lifecycle, reads lock files

### Established Patterns
- Lock files at `{stateHome}/lane-driver/{project-hash}.lock`
- Lane driver is Python (`gsd_lane_driver.py`) with `--detach` mode
- Process liveness uses `process.kill(pid, 0)` with ESRCH/EPERM handling

### Integration Points
- `gsd_lane_driver.py` in gsd-config — writes the lock file (Python side)
- `lane-driver-manager.ts` in pi-web — reads/checks the lock file (Node side)
- Phase 6 (Lane Driver Status UI) will consume the v2 lock schema

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description, success criteria, and research SUMMARY.md.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
