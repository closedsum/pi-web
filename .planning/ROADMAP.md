# Roadmap: Pi Web — Enhanced Orchestration

## Milestone: v2.0 — Enhanced Orchestration

**Phases:** 4 (Phase 5–8, continuing from v1.0)
**Requirements:** 20 v2 requirements
**Coverage:** 100% — all v2 requirements mapped

---

### Phase 5: PID Resilience

**Goal:** Upgrade the lane driver lock schema to include process identity (start time, boot ID, nonce) so PID reuse cannot cause false liveness or stale-lock adoption. Python-side implementation per "Python-first" rule.

**Requirements:** PID-01, PID-02, PID-03, PID-04, TEST-01, TEST-02

**Success Criteria:**
1. Lock schema v2 writes `{schema:2, pid, proc_start, boot_id, instance_nonce, heartbeat_seq, heartbeat_at, state, last_error}` atomically via `os.replace`
2. `verify_identity(lock_data)` returns `True` only when PID exists AND proc_start matches recorded value (±1s on macOS)
3. Pre-v2 lock files (missing `proc_start`) report status as `unverified` — no crash, no false positive
4. Heartbeat timestamp advances from the daemon's work loop, not a separate timer thread
5. Co-located tests cover identity mismatch, stale PID, pre-v2 lock, and atomic write failure

**Depends On:** Nothing (foundation for phases 6–8)

**UI hint:** no

---

### Phase 6: Lane Driver Status UI

**Goal:** Expose lane driver daemon state through a read-only API route and render a real-time status badge in the task panel, with single-flight polling and visibility gating.

**Requirements:** UI-01, UI-02, UI-03, UI-04, TEST-01

**Success Criteria:**
1. `GET /api/lane-driver/status` returns a DTO with `{status, heartbeatAge, reason, schema}` using `force-dynamic` + `Cache-Control: no-store`
2. Parse failures (missing file, malformed JSON, I/O error) return `{status: "unknown", reason: "..."}` — never 500
3. React `DriverStatusBadge` renders a discriminated union across all 5 states (`running | stopped | errored | stale | unknown`) with heartbeat age display
4. Client polling uses single-flight `setTimeout` at 5s while visible, pauses while tab is hidden, applies exponential backoff on consecutive errors
5. Co-located tests cover all 5 status states, polling lifecycle (mount/unmount/visibility), and API error paths

**Depends On:** Phase 5 (lock schema v2 provides the snapshot the API reads)

**UI hint:** yes — status badge in task panel

---

### Phase 7: Block Rule Telemetry

**Goal:** Instrument the block rule evaluation pipeline with per-session timing and block counts, exposed through atomic snapshots — establishing a measured baseline before the async conversion in Phase 8.

**Requirements:** TEL-01, TEL-02, TEL-03, TEL-04, TEL-05, TEST-01, TEST-03

**Success Criteria:**
1. A per-session `TelemetryCollector` wraps each rule at registration with timing (`performance.now()`) and block/allow counters
2. Only rules that execute are counted — rules short-circuited by an earlier block are excluded from the evaluation count
3. `snapshot()` returns a frozen copy; snapshots are written atomically (temp + rename) and debounced to avoid I/O storms
4. A telemetry write failure (disk full, permission) never changes an authorization decision — the block/allow verdict is always returned
5. No raw tool arguments, command strings, or absolute file paths appear in telemetry output (redaction)

**Depends On:** Phase 5 (state-home for snapshot paths), Phase 6 (pattern for atomic file reads)

**UI hint:** no (API-only in v2.0; UI dashboard is future work)

---

### Phase 8: Async Block Rules

**Goal:** Add an async evaluation path using the gather-then-decide pattern — prefetch git facts asynchronously, then run existing sync rules over the frozen context. Keeps sync API unchanged.

**Requirements:** ASYNC-01, ASYNC-02, ASYNC-03, ASYNC-04, TEST-01

**Success Criteria:**
1. `evaluateBlockRulesAsync(rules, toolCall, ctx)` prefetches git facts (rev-parse, log) via promisified `execFile` with `AbortSignal`, `timeout`, `maxBuffer`, `windowsHide`, and no `shell` — then passes the frozen context to sync rules
2. Sync `evaluateBlockRules` remains unchanged; throws `TypeError` if any rule returns a thenable (safety net)
3. Async git queries use `git.exe` directly (not `shell: true`) per CVE-2024-27980 class guidance
4. Each async rule has an explicit fail-closed or fail-open timeout policy, configurable per rule, with `AbortSignal` killing the child process on timeout
5. Co-located tests cover: async prefetch success, timeout with abort, mixed sync/async path, thenable rejection in sync path

**Depends On:** Phase 7 (telemetry baseline to measure async improvement), Phase 5 (state-home), verification that `pi.on('tool_call')` awaits async handlers

**UI hint:** no

---

## Phase Summary

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 5 | PID Resilience | Lock schema v2 + identity verification | PID-01..04, TEST-01,02 | 5 |
| 6 | Lane Driver Status UI | API route + React status badge | UI-01..04, TEST-01 | 5 |
| 7 | Block Rule Telemetry | Per-session instrumentation + snapshots | TEL-01..05, TEST-01,03 | 5 |
| 8 | Async Block Rules | Gather-then-decide async evaluation | ASYNC-01..04, TEST-01 | 5 |

---
*Roadmap created: 2026-10-15*
*Last updated: 2026-10-15 — milestone v2.0*
