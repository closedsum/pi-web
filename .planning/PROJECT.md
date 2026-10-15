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

### Active

- [ ] Port ensure-lane-driver hook (daemon lifecycle management)
- [ ] Port fork-completion-gate hook (fork tracking)
- [ ] Port block-probe-in-fork hook (probe awareness)
- [ ] Port audit-scope-guard hook (audit scope enforcement)
- [ ] Port block-manual-integrate hook (autopilot lock/PID checks)
- [ ] Port block-redispatch-without-fix hook (manifest + git history queries)

### Out of Scope

- Full Pi CLI feature parity — pi-web is a web UI, not a CLI replacement
- Database storage — file-based persistence is intentional (JSONL, JSON)
- Multi-user authentication — single-developer tool with optional password gate
- Mobile-first design — desktop browser is the primary target

## Context

Pi-web wraps the `@earendil-works/pi-*` SDK (v1.2.0) and exposes coding-agent sessions through a Next.js App Router application. The extension system (`lib/extensions/tool-blockers.ts`) already has 21 block rules ported from Claude CLI PreToolUse hooks. The remaining 6 hooks require infrastructure that doesn't exist yet in pi-web — daemon lifecycle tracking, fork/probe state, autopilot lock files, and git history queries from within the extension context.

The GSD lane extension (`lib/gsd-lane-extension.ts`) enforces orchestrator mode via a tool-call allow-list gate. The dispatch status reader (`lib/dispatch-status.ts`) already parses lane manifests from `.planning/impl-lanes/p-*.json`. These are the foundation for the infrastructure-dependent hooks.

## Constraints

- **Runtime:** Node.js >=22.19.0 with `--experimental-strip-types`
- **Framework:** Next.js 16 App Router — no Pages Router
- **SDK:** Must use `@earendil-works/pi-*` v1.2.0 APIs for session and extension management
- **Extensions:** Block rules must be pure functions in `tool-blockers.ts` with the existing `BlockRule` signature
- **Testing:** Co-located `.test.mjs` files using `node --test` with jiti fallback for TS imports

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pure-function block rules | Testable without mocking agent internals | ✓ Good |
| Extension system via pi.on("tool_call") | Aligns with pi SDK's event model | ✓ Good |
| File-based state (no DB) | Matches pi CLI's approach, zero-config | ✓ Good |
| Infrastructure hooks need new pi-web services | CLI hooks read daemon PIDs, lock files, git history — pi-web needs equivalent abstractions | — Pending |

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
*Last updated: 2026-10-14 after initialization*
