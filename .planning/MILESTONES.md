# Milestones

## v2.0 Enhanced Orchestration (Shipped: 2026-10-15)

**Phases:** 5-8 (4 phases, 8 plans, 136 tests)

**Key accomplishments:**
- PID resilience: lock schema v2 with process identity (start time, boot ID, nonce)
- Lane driver status UI: real-time badge in task panel with single-flight polling
- Block rule telemetry: per-session timing and block counts via atomic snapshots
- Async block rules: async evaluation pipeline with timeout and cancellation

**Archive:** `.planning/milestones/v2.0-phases/`

---

## v1.0 Orchestration Hook Porting (Shipped: 2026-10-15)

**Phases:** 1-4 (4 phases, 11 plans)

**Key accomplishments:**
- Foundation infrastructure: state-home resolver, process-liveness, git-query, shell-command parser
- BlockRule context: optional context parameter, block-probe-in-fork, fork-completion-gate
- InlineExtension hooks: lane driver manager, orchestrator mode enforcement
- Audit scope extension: audit-scope block rule with session-scoped allow-list

**Archive:** `.planning/milestones/v1.0-phases/`

---
