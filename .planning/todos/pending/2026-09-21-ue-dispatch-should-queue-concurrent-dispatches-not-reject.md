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

Change ue_dispatch (or gsd-ue-dispatch.ts) to queue behind the running dispatch
instead of rejecting. Accept the call, return a "queued" status, and execute
when the lock releases. The orchestrator model should see "queued" not "failed".
