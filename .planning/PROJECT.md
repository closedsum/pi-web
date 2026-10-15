# Pi Web

## What This Is

Web UI for the Pi coding agent — a full-stack Next.js application that hosts coding-agent sessions with chat, terminal, file explorer, model selector, task panel, and a modular extension system. Used by a single developer to run GSD-orchestrated coding sessions through a browser interface instead of the CLI.

## Core Value

Agent sessions execute with the same safety rules and orchestration enforcement as the CLI — no tool call bypasses the extension system.

## Requirements

### Validated

- ✓ Web-based coding agent IDE (chat, terminal, file explorer, task panel) — existing
- ✓ RPC session management (start, stop, message routing, idle cleanup) — existing
- ✓ AI provider abstraction with multi-provider model catalog — existing
- ✓ MCP server management (lifecycle, OAuth, tool routing, policy) — existing
- ✓ Extension system with tool-call interception (21 block rules) — existing
- ✓ Orchestrator mode with allow-list gate (DispatchLane, CheckLaneStatus) — existing
- ✓ Lane dispatch status monitoring from pipeline manifests — existing
- ✓ Task board display from board.jsonl — existing
- ✓ Model selector with per-provider color coding — existing
- ✓ Terminal/PTY sessions with xterm.js — existing
- ✓ Push notifications via VAPID web-push — existing
- ✓ File operations with path-traversal security — existing
- ✓ Git integration (status, diffs, worktrees) — existing
- ✓ Subagent creation and tracking — existing

- ✓ State home resolver, process liveness, git query, shell command parser — v1.0
- ✓ BlockRuleContext type extension with backward compatibility (23 rules) — v1.0
- ✓ Port block-probe-in-fork hook (subagent-aware probe blocking) — v1.0
- ✓ Port fork-completion-gate hook (fork result validation) — v1.0
- ✓ Port block-manual-integrate hook (autopilot lock/PID liveness) — v1.0
- ✓ Port block-redispatch-without-fix hook (pipeline + git history) — v1.0
- ✓ Port ensure-lane-driver hook (daemon lifecycle management) — v1.0
- ✓ Port audit-scope-guard hook (scope token enforcement) — v1.0

### Active

- ENH-01: Async block rule support (non-blocking git queries for high-latency repos)
- ENH-02: Block rule telemetry (count blocks per rule per session)
- ENH-03: proc_start matching for PID reuse detection on all platforms
- ENH-04: Real-time lane driver status in UI (running/stopped indicator)

## Current Milestone: v2.0 Enhanced Orchestration

**Goal:** Harden the orchestration extension system with async support, telemetry, PID resilience, and real-time driver visibility.

**Target features:**
- Async block rule evaluation with non-blocking git queries
- Block rule telemetry and session-level instrumentation
- Defense-in-depth PID reuse detection via proc_start matching
- Real-time lane driver status indicator in the UI

### Out of Scope

- Full Pi CLI feature parity — pi-web is a web UI, not a CLI replacement
- Database storage — file-based persistence is intentional (JSONL, JSON)
- Multi-user authentication — single-developer tool with optional password gate
- Mobile-first design — desktop browser is the primary target

## Context

Pi-web wraps the `@earendil-works/pi-*` SDK (v1.2.0) and exposes coding-agent sessions through a Next.js App Router application. The extension system has 23 BlockRules (21 original + 2 context-aware) plus 3 InlineExtension handlers and a lane driver manager. All 6 orchestration hooks from the CLI are now ported as of v1.0.

Foundation utilities in `lib/`: state-home resolver, process liveness checker, git query wrapper, shell command parser. These are consumed by the context-aware rules and InlineExtension handlers. The audit scope extension intercepts Write/Edit in audit sessions and enforces scope boundaries via base64url scope tokens.

v2.0 targets: async evaluation path for block rules (ENH-01), telemetry instrumentation (ENH-02), proc_start PID resilience (ENH-03), and lane driver UI status (ENH-04).

## Constraints

- **Runtime:** Node.js >=22.19.0 with `--experimental-strip-types`
- **Framework:** Next.js 16 App Router — no Pages Router
- **SDK:** Must use `@earendil-works/pi-*` v1.2.0 APIs for session and extension management
- **Extensions:** Block rules are pure functions with optional `BlockRuleContext` parameter; InlineExtension handlers for complex hooks
- **Testing:** Co-located `.test.mjs` files using `node --test` with jiti fallback for TS imports

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pure-function block rules | Testable without mocking agent internals | ✓ Good |
| Extension system via pi.on("tool_call") | Aligns with pi SDK's event model | ✓ Good |
| File-based state (no DB) | Matches pi CLI's approach, zero-config | ✓ Good |
| Infrastructure hooks need new pi-web services | CLI hooks read daemon PIDs, lock files, git history — pi-web needs equivalent abstractions | ✓ Good — 4 utility modules + InlineExtension pattern |
| Hybrid BlockRule + InlineExtension architecture | Simple gates as BlockRules with optional context, complex hooks as InlineExtension handlers | ✓ Good — clean separation of concerns |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-15 after v2.0 milestone start (Enhanced Orchestration)*
