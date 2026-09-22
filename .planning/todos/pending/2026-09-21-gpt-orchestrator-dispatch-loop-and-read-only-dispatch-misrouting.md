---
created: 2026-09-22T00:10:00.000Z
title: GPT orchestrator dispatch loop and read-only dispatch misrouting
area: tooling
files:
  - lib/gsd-lane-extension.ts:161
  - lib/gsd-lane-extension.ts:181
---

## Problem

E2E results (16/22 pass, openai-codex/gpt-5.6-sol):

1. **DISPATCH_LOOP (3 failures):** GPT dispatches a lane, sees it fail via
   CheckDispatchStatus (scope/infra preflight error), then retries with a
   second DispatchLane call. `MAX_DISPATCHES_PER_TURN=2` allows this. The model
   should report the failure, not retry — the retry fails the same way.

2. **UNEXPECTED_DISPATCH (1 failure):** GPT dispatched a lane for
   "What changed in the last 5 commits?" — a read-only question answerable with
   `read`/`grep`. The promptGuidelines say "For pure questions: answer directly"
   but GPT still dispatched.

3. **NO_TEXT_RESPONSE (1 failure):** GPT read 25+ files for a code-explanation
   question but timed out before producing a text response.

## Solution

1. Set `MAX_DISPATCHES_PER_TURN = 1` in gsd-lane-extension.ts:161. On infra
   failure, the auto-flip to inline mode handles retry — the model doesn't need
   a second dispatch.

2. Add explicit negative examples to `promptGuidelines`: "Do NOT dispatch for
   questions about git history, code explanation, or status checks — use read/
   grep tools directly."

3. The timeout issue (code-explanation) may resolve with the dispatch limit
   fix (fewer round-trips per turn).
