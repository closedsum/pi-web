---
created: 2026-09-21T23:15:00.000Z
title: ue_dispatch should queue concurrent dispatches not reject
area: tooling
files:
  - lib/gsd-lane-extension.ts:24
---

## Problem

When GPT in orchestrator mode dispatches two sequential UE actions (e.g. patrol
setup then 100 units/sec update), the second dispatch fails with a 30-second
lock timeout because the first dispatch still holds the UE dispatch lock. The
model sees a failure and can't recover — work that should have been queued is
lost.

## Solution

Add a global `dispatch.queue_concurrent` list in `~/.gsd/defaults.json` naming
tools/scripts that should queue instead of reject (e.g. `["ue_dispatch"]`).
CLI-agnostic — any CLI (Claude, GPT, Codex) reads the same config.

When a listed tool hits a lock, the dispatcher accepts the call, returns
`"queued"` status, and executes when the lock releases. The orchestrator model
sees "queued" not "failed".
