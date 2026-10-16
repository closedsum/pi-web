# Cross-Session Coupling Analysis

**Date:** 2026-10-16
**Context:** Board item #15 — "pi-web work blocked on lane/orchestration landing chain"

## Coupling Points

Pi-web depends on gsd-config at runtime through these paths:

| Coupling | Files | Direction |
|----------|-------|-----------|
| CLI invocation | `lib/gsd-lane-extension.ts` calls `gsd-config.py get` and `gsd_impl_lane.py resolve-model` | pi-web → gsd-config |
| Lane pipeline | `DispatchLane` tool spawns `gsd_impl_lane.py` as a subprocess | pi-web → gsd-config |
| Hook system | Extension block rules port behavior from `get-shit-done/hooks/*.cjs` | conceptual (code copied, not imported) |
| Manifest format | `lib/dispatch-status.ts` reads `p-*.json` written by `gsd_impl_lane.py` | gsd-config → pi-web (data contract) |
| Test hooks | `test/extensions/_hooks.mjs` loads real gsd-config hooks for model tables | test-time → gsd-config |
| Board data | `lib/task-board.ts` reads `board.jsonl` written by `gsd_board.py` | gsd-config → pi-web (data contract) |

## Observed Problems (2026-09-23 session)

1. **Landing chain serialization:** Every gsd-config branch waits in a queue for the supervisor session to land it on master. Pi-web sessions that produce gsd-config fixes get blocked.
2. **Master drift:** Supervisor auto-commits move gsd-config master under active branches, requiring repeated rebases (c3bdef8→b17c8b4→cfa5fb3→93cb2c8→cc78696 in one session).
3. **Live-tree regressions:** A gsd-config change (819fc3f) broke UE launch for all sessions, including pi-web.
4. **File-scope negotiation:** Each gsd-config change needs write-scope coordination with other active branches.

## Decoupling Options

### Option A: Pin to gsd-config release (recommended)

Pi-web pins to a tagged gsd-config version (e.g., `gsd-config@v1.5.0`) instead of tracking HEAD. The pin lives in `.planning/config.json` as `gsd_config_version`. Pi-web sessions use only the pinned APIs. Upgrades are explicit (`/gsd:update` bumps the pin).

**Pros:** No surprise breakage, no landing-chain blocking, independent velocity.
**Cons:** Misses gsd-config improvements until explicitly upgraded. Requires gsd-config to maintain backward compatibility at the data-contract level.

### Option B: Snapshot CLI outputs (partial decoupling)

Instead of calling gsd-config CLIs at runtime, pi-web reads cached/mocked outputs during development. Only the lane dispatch path needs the real CLI. Tests already do this via `makeStubGsd()` in the test suite.

**Pros:** Faster test cycles, no runtime dependency for read-only operations.
**Cons:** Dispatch still needs real gsd-config. Cache staleness risk.

### Option C: Extract data contracts to a shared schema

The manifest format (`p-*.json`) and board format (`board.jsonl`) become versioned JSON schemas shared between repos. Both repos validate against the schema. Breaking changes require a schema version bump.

**Pros:** Formal contract, both sides can evolve independently within the contract.
**Cons:** Schema maintenance overhead. Only helps data contracts, not CLI invocations.

## Recommendation

**Option A (pinned version) for immediate relief, Option C (shared schemas) for long-term stability.**

The urgent problem is landing-chain serialization. Pinning to a release eliminates it immediately. Shared schemas prevent the subtler data-format drift (like the manifest `Worktree` path quoting bug that 1A fixed).

The CLI invocation coupling (resolveWorktreeRoot, resolveModel) is now resilient to output format variations after the 1A fix, so it's lower priority to decouple.

## Action Items

1. Tag gsd-config releases when stable (e.g., after the hook-gate test fixes land)
2. Add `gsd_config_version` to pi-web `.planning/config.json`
3. Document which gsd-config CLI commands pi-web calls and their expected output shapes
4. Consider JSON Schema files for `p-*.json` and `board.jsonl` in a future milestone
