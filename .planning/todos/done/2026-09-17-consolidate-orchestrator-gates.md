---
created: 2026-09-17T21:50:00.000Z
title: Consolidate orchestrator gate hooks into single Pi extension
area: extensions
files:
  - test/extensions/orchestrator-allowlist/
  - test/extensions/block-orchestrator-ue-planning/
  - test/extensions/e2e/orchestrator-allowlist/
---

## Problem

Three Claude hooks (orchestrator-allowlist, block-orchestrator-ue-planning, delegate-bounded-tasks) each spawn a separate Node.js process for the same tool_call event. In Pi, these should be one `gsd-orchestrator-gate` extension with a combined allowlist, eliminating 240ms+ of redundant fork overhead per Bash/PowerShell call.

## Solution

Create `~/gsd-config/pi-config/extensions/gsd-orchestrator-gate.ts` that combines all three rule sets into one `tool_call` handler. Test fixtures already exist for each; E2E tests verify the combined behavior.
