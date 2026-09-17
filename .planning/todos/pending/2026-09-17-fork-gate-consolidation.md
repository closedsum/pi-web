---
created: 2026-09-17T21:50:00.000Z
title: Verify lane pipeline covers fork-gate rules (Pi has no forks)
area: extensions
files:
  - test/extensions/fork-ledger/
---

## Problem

Five Claude hooks gate Agent/fork dispatches: cap enforcement, scope validation, push blocking, background flag, model floor. Pi does NOT have Agent/fork — parallelism is through lanes via the orchestrator. Most of this logic already lives in gsd_impl_lane.py (concurrency cap, WriteScope, model routing).

## Solution

Audit gsd_impl_lane.py to confirm it covers:
- Concurrency cap (fork-ledger equivalent) → `max_concurrent_streams` config
- Scope isolation (require-fork-scope equivalent) → `WriteScope` in lane spec
- Commit ownership (block-fork-push equivalent) → lane pipeline owns commits
- Model routing (fork-capability-floor equivalent) → `enforce-provider-diversity`

Any gaps → add to lane pipeline, not as a Pi extension. Test fixtures for the unit tests still valid as documentation of the rules.
