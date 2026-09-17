---
created: 2026-09-17T21:50:00.000Z
title: Consolidate failure tracking into single Pi extension with in-memory state
area: extensions
files:
  - test/extensions/fix-failure-tracker/
  - test/extensions/fix-failure-gate/
  - test/extensions/failure-pattern-detector/
---

## Problem

Three hooks share failure tracking logic via file-based state (JSON in tmp). In Claude, each spawns a separate process and reads/writes the same state file. This is both slow (file I/O per call) and fragile (race conditions on concurrent reads).

## Solution

Create `gsd-failure-gate` Pi extension with in-memory failure count. One `tool_call` handler for the gate (blocks Edit/Write after 2+ failures), one `tool_result` handler for the tracker (increments/resets count), and pattern detection integrated. No file I/O needed in-process.
