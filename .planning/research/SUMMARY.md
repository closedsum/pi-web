# Research Summary: v2.0 Enhanced Orchestration

## Source
Cross-research pipeline — 3 models participated (opus55, gpt6, qwen38), synthesis produced.
Full outputs: `.planning/research/cross-research/`

## Consensus Findings (high confidence)

- **Gather-then-decide pattern:** prefetch git facts asynchronously once per tool call into a frozen context, then run all 23 existing rules as pure sync functions — only the context builder is async, no rule rewrites needed
- **Keep sync `evaluateBlockRules` unchanged**, add separate `evaluateBlockRulesAsync` — changing the return type breaks callers and tests
- **Python owns process identity:** `psutil.Process(pid).create_time()` on the Python side, matching "Python-first" rule. Lock schema v2: `{pid, proc_start, boot_id, instance_nonce, heartbeat_seq}`
- **Async git:** promisified `execFile` with `signal`, `timeout`, `maxBuffer`, `windowsHide`, no shell — wrapping `execFileSync` in Promise does nothing
- **Telemetry:** per-session collector, decorator at registration, fixed-bucket histograms, count only invoked rules, redact paths/args, failures isolated from verdicts
- **Daemon status:** atomic snapshot from Python daemon, read-only Next.js route (`force-dynamic` + `no-store`), `unknown` distinct from `stopped`
- **UI polling:** single-flight `setTimeout` (5s visible, paused hidden, backoff on errors), discriminated union for status badge

## Unique Findings (flag for review)

- `wmic` removed in Windows 11 24H2 (this machine) — must use CIM or psutil
- `node:diagnostics_channel` as zero-dependency telemetry bus
- Start/stop buttons are anti-feature until auth/CSRF — read-only status only in v2.0
- Advance heartbeat from work loop (separate thread masks deadlocks)
- Exiting old daemon can delete replacement's files — check ownership via nonce

## Conflicts & Resolution

1. **Process identity probe location:** Python (consensus) vs Node. Resolved: Python, per "Python-first" rule
2. **Async rule evaluation order:** Sequential (consensus) — avoids unnecessary git subprocesses after early block
3. **evaluateBlockRules signature:** Keep sync, add separate async function
4. **Build order:** PID/lock v2 → status API/UI → telemetry baseline → async prefetch

## Unified Recommendation

1. **Phase 0 gate:** Verify `pi.on('tool_call')` awaits async handlers (blocks ENH-01)
2. **Lock schema v2:** `{schema:2, pid, proc_start, boot_id, instance_nonce, heartbeat_seq, heartbeat_at, state, last_error}` — atomic `os.replace`, Python-side identity verification
3. **Status API:** Read-only route → snapshot DTO, parse failures → `unknown`, single-flight poll with discriminated-union badge
4. **Telemetry:** Session-scoped decorator, fixed-bucket histograms, atomic debounced snapshots
5. **Async:** Memoized lazy `prefetchGitFacts` with promisified `execFile`, rules stay sync over frozen context

## Gaps & Open Questions

- Does `pi.on('tool_call')` await async handlers? (Blocks ENH-01)
- Daemon runtime: native Windows Python or WSL? (Affects PID identity checks)
- Spawned vs adopted daemon (spawned → process handle removes PID-reuse problem)
- Whether psutil is already a lane-driver dependency
- Whether the web UI already uses SWR or TanStack Query
- No measured baseline for git/rule latency — timeout values unvalidated
