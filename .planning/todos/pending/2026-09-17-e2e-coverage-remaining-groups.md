---
created: 2026-09-17T21:50:00.000Z
title: Add E2E test fixtures for remaining consolidation groups
area: testing
files:
  - test/extensions/e2e/
---

## Problem

Only 5 E2E fixtures exist (21 tests) covering 3 of the 11 consolidation groups. The commit-gate group, failure-gate group, fork-gate group, lane-ops group, UE-dispatch group, and session-init group have no E2E coverage yet.

## Solution

Add scope-isolated E2E fixtures for each remaining group, using the existing _e2e-harness.mjs. Priority: commit-gate (most complex, 475 lines), fork-ledger (cap enforcement), failure-gate (stateful). Each fixture configurable via PI_TEST_MODEL/PI_TEST_EFFORT.
