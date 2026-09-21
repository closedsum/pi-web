---
created: 2026-09-21T17:04:22.489Z
title: Environment-agnostic orchestrator enforcement across CLI and pi-web
area: tooling
files:
  - lib/gsd-lane-extension.ts
  - ~/.claude/get-shit-done/bin/
  - ~/.claude/CLAUDE.md
---

## Problem

Orchestrator enforcement (tool_call allow-list gate, dispatch-only mode) only exists in pi-web via `gsd-lane-extension.ts`. Claude CLI sessions have no equivalent — the main session implements directly with Read/Write/Edit/Bash/PowerShell instead of delegating to forks or lanes. This means behavior differs across environments: GPT-5.6 Sol in pi-web is forced to dispatch, but Opus 4.6 in Claude CLI can implement inline without constraint.

## Solution

Cross-research needed. Options:
1. **Claude CLI hooks** — block inline implementation (Write/Edit/Bash) in the main session when a lane or fork should be used
2. **CLAUDE.md directive** — enforce via instructions that the main session delegates implementation to forks/lanes (prompt-level, not code-level)
3. **Environment-agnostic gate** — shared orchestrator enforcement in the GSD extension/hook system that works in both pi-web and Claude CLI

Key considerations: Claude CLI doesn't have `pi.on("tool_call")` — enforcement would need to use Claude Code hooks (`hooks/` in settings.json). The fallback escape hatch design from the cross-research report applies here too.
