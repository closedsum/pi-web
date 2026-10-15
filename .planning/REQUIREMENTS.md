# Requirements: Pi Web — Orchestration Hook Porting

**Defined:** 2026-10-15
**Core Value:** Agent sessions execute with the same safety rules and orchestration enforcement as the CLI

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Foundation Infrastructure

- [ ] **INFRA-01**: State home path is resolvable from GSD_STATE_HOME env var or default ~/.gsd
- [ ] **INFRA-02**: PID liveness can be checked cross-platform (process.kill signal-zero)
- [ ] **INFRA-03**: Git queries (rev-parse, log) can be executed synchronously with timeout protection
- [ ] **INFRA-04**: Shell commands can be parsed to extract named arguments (--params-file)

### BlockRule Context Extension

- [ ] **CTX-01**: BlockRule type accepts an optional context parameter with cwd, isSubagent, sessionId, stateHome
- [ ] **CTX-02**: evaluateBlockRules passes context when available, undefined when not
- [ ] **CTX-03**: Existing 21 rules continue to work unchanged (backward compatible)

### Tool-Call Gates

- [ ] **GATE-01**: Probe commands (gsd_probe.py/gsd-probe) are blocked when caller is a subagent
- [ ] **GATE-02**: TaskUpdate(completed) is blocked when fork result state file is missing or invalid
- [ ] **GATE-03**: Integration commands (git cherry-pick, git merge, integrate) are blocked when autopilot daemon is active
- [ ] **GATE-04**: Pipeline redispatch is blocked when prior pipeline failed and no fix commit exists in write scope

### Session Services

- [ ] **SVC-01**: Lane driver daemon is checked/spawned at session start for eligible projects
- [ ] **SVC-02**: Audit scope extension intercepts Write/Edit from audit sessions and enforces scope boundaries

### Testing

- [ ] **TEST-01**: Each utility module has co-located unit tests with edge cases
- [ ] **TEST-02**: Each block rule has allow/block test cases using existing test harness
- [ ] **TEST-03**: Sync git operations complete within 50ms on representative repos
- [ ] **TEST-04**: PID liveness checks handle ESRCH, EPERM, and stale PID scenarios

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Enhanced Orchestration

- **ENH-01**: Async block rule support (non-blocking git queries for high-latency repos)
- **ENH-02**: Block rule telemetry (count blocks per rule per session)
- **ENH-03**: proc_start matching for PID reuse detection on all platforms
- **ENH-04**: Real-time lane driver status in UI (running/stopped indicator)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full shell parser | Regex on known invocation patterns is sufficient; full parser is overkill |
| Cross-platform proc_start | signal-zero PID check is adequate for v1; proc_start is defense-in-depth |
| Audit scope UI | Audit fixers in pi-web are future work; the extension just needs the gate |
| Hook hot-reload | Extensions load at session start; restarting the session reloads |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| CTX-01 | Phase 2 | Pending |
| CTX-02 | Phase 2 | Pending |
| CTX-03 | Phase 2 | Pending |
| GATE-01 | Phase 2 | Pending |
| GATE-02 | Phase 2 | Pending |
| GATE-03 | Phase 3 | Pending |
| GATE-04 | Phase 3 | Pending |
| SVC-01 | Phase 3 | Pending |
| SVC-02 | Phase 4 | Pending |
| TEST-01 | Phase 1-3 | Pending |
| TEST-02 | Phase 2-3 | Pending |
| TEST-03 | Phase 1 | Pending |
| TEST-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-10-15*
*Last updated: 2026-10-15 after initialization*
