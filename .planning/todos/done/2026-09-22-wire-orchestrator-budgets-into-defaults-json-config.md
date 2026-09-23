---
created: 2026-09-22T04:42:30.776Z
title: Wire orchestrator budgets into defaults.json config
area: tooling
files:
  - lib/gsd-lane-extension.ts:147-154
  - ~/.gsd/defaults.json:12-15
---

## Problem

The pi-web gsd-lane-extension hardcodes all orchestrator budgets as constants:
- `MAX_DISPATCHES = 1`
- `DISPATCH_COOLDOWN_MS = 45_000`
- `MAX_READS = 8`
- `READ_COOLDOWN_MS = 45_000`
- `MAX_BLOCKS_PER_TURN = 3`

These values are not configurable via `~/.gsd/defaults.json` despite an existing
`orchestrator_mode` section in that config. Different models need different budgets
(Opus can handle 15 reads, GPT needs 8), and the cooldown values are timing
heuristics that should be tunable without code changes.

The extension's `GsdLaneExtensionOptions` interface only accepts `{ cwd, gsdBinDir?, python? }` — no budget overrides.

## Solution

1. Add an `orchestrator_budgets` key to `~/.gsd/defaults.json` under `orchestrator_mode`:
   ```json
   "orchestrator_mode": {
     "enforce_delegation": true,
     "budgets": {
       "max_dispatches": 1,
       "dispatch_cooldown_ms": 45000,
       "max_reads": 8,
       "read_cooldown_ms": 45000,
       "max_blocks_per_turn": 3
     }
   }
   ```
2. Read via `gsd-config.py get orchestrator_mode.budgets` at extension load time
3. Accept overrides in `GsdLaneExtensionOptions` for per-session tuning
4. Consider per-model overrides (keyed by provider/model pattern)
