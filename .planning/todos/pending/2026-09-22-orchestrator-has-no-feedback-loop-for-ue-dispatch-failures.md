---
created: 2026-09-22T06:39:16.245Z
title: Orchestrator has no feedback loop for ue_dispatch failures
area: tooling
files:
  - lib/gsd-lane-extension.ts
  - ~/.pi/agent/extensions/gsd-ue-dispatch.ts
  - .planning/threads/dispatch-progress.json
---

## Problem

When the UE editor crashes mid-session, the GPT orchestrator has no mechanism to
detect, diagnose, or inform the user. The gap has three layers:

1. **No process monitoring:** `ue_dispatch` is fire-and-forget. It spawns the
   editor and returns immediately. There is no exit handler watching the process.
   The `dispatch-progress.json` file shows "failed" status only if the dispatch
   script itself fails — not if the editor crashes later.

2. **No auto-polling:** After dispatching, the orchestrator doesn't automatically
   check `CheckDispatchStatus`. The model has the tool but only calls it if
   prompted. A crash that happens 30 seconds after dispatch goes unnoticed.

3. **No diagnostic behavior:** Even when the model discovers a failure via
   `CheckDispatchStatus`, the prompt guidelines say nothing about diagnosing
   crashes. The model reports "failed" but doesn't read logs, check process
   state, or suggest root causes.

Observed: editor crashed → GPT continued as if nothing happened → user had to
notice and ask about it manually.

## Solution

1. **Process exit monitoring** (gsd-ue-dispatch.ts): Watch spawned editor PID.
   On unexpected exit, write failure to `dispatch-progress.json` and call
   `pi.sendMessage` with `triggerTurn: true` to alert the orchestrator.

2. **Auto-poll after dispatch** (gsd-lane-extension.ts): After `ue_dispatch`
   returns success, schedule a delayed status check (e.g., 10s). If still
   running, no action. If failed, inject a steering message.

3. **Diagnostic prompt guideline**: Add to DispatchLane promptGuidelines:
   "When a dispatch or UE operation fails, read the relevant log files and
   dispatch-progress.json to diagnose the cause before reporting to the user."

Layer 1 is the most impactful — it makes the system reactive instead of
requiring the user to notice the failure.
