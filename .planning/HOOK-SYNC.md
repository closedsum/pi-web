# Hook Sync: Claude → Pi

One-way sync process that pulls Claude hook logic into Pi extensions without overwriting Pi-specific optimizations. Run after any Claude hook change that should reach Pi.

## Architecture

Claude: 65+ separate `.cjs` hooks, each spawned as a process (80-120ms overhead per invocation)
Pi: Consolidated `.ts` extensions running in-process, grouped by concern

## Consolidation Map

Claude hooks map N:1 to Pi extension groups. Pi groups are the optimization target — never split back to 1:1.

| Pi Extension Group | Claude Hooks (source of truth for rules) | Pi-specific optimization |
|----|----|-----|
| `gsd-orchestrator-gate` | orchestrator-allowlist, block-orchestrator-ue-planning, delegate-bounded-tasks | Single `tool_call` handler, combined allowlist + UE block + delegation check |
| `gsd-failure-gate` | fix-failure-tracker, fix-failure-gate, failure-pattern-detector | Shared in-memory failure state (no file I/O per call) |
| `gsd-commit-gate` | commit-gate, doc-chain-check, script-index-gate, build-verify-gate, build-verify-reminder | Single git-command interceptor, evidence scan once |
| `gsd-lane-governance` | fork-ledger → lane concurrency cap, require-fork-scope → lane WriteScope, block-fork-push → lane owns commits, fork-capability-floor → provider diversity, warn-fork-claude-model → model routing | **Most logic lives in gsd_impl_lane.py already** — Pi does NOT have Agent/fork; verify lane pipeline covers these rules, skip redundant re-implementation |
| `gsd-session-init` | gsd-session-selfcheck, task-board-restore, session-lane-sweep, ensure-session-monitor, proc-tree-sweep | `session_start` only (NOT per-event) |
| `gsd-autonomy-contract` | enforce-gap-tasking, session-reminder, route-task-skill, autonomous-sentinel | Already exists (423 lines) |
| `gsd-checklist` | task-register-mirror, task-board-restore | Already exists (multi-file) |
| `gsd-ue-dispatch` | ue-action-dispatch, ue-ops-reminder, ue-dispatch-policy, ue-api-map-gate | Single `tool_call` + `input` handler for UE routing |
| `gsd-lane-ops` | enforce-provider-diversity, enforce-parallel-delegation, task-lane-stamp, lane-terminal-reconcile, lane-terminal-notice, batch-merge-trigger, post-merge-push-trigger | Lane lifecycle manager |
| `gsd-observe` | observe-effectiveness, hook-release-dispatcher | Observe-only, never blocks |
| **Standalone (1:1)** | block-ps-utf8-bom, block-livecoding, commit-msg-no-bom, md-threshold-gate, md-chain-integrity-gate, memory-index-lint, review-reminder, session-end-commit-check, deny-junction-surgery | Small enough to stay 1:1 |

## Migration Disposition: DROP / OVERLAP / ALREADY HANDLED

Hooks that should NOT be re-implemented in Pi. Preserve this table across syncs.

### DROP for Pi (Claude-specific, no Pi equivalent needed)

| Hook | Reason |
|------|--------|
| `warn-fork-claude-model` | Pi has no forks — model selection goes through lane manifest |
| `block-fork-push` | Pi has no forks — lanes own their commits via pipeline |
| `block-fork-background` | Pi has no forks — lanes run in isolated worktrees |
| `fork-capability-floor` | Pi has no forks — provider-diversity handles model assignment |
| `require-fork-scope` | Pi has no forks — lanes use WriteScope in spec |
| `fork-ledger` | Pi has no forks — lane concurrency managed by `gsd_impl_lane.py max_concurrent_streams` |
| `block-send-feedback` | Pi has no SendFeedback tool |
| `hook-release-dispatcher` | Claude-specific shadow release comparison; Pi extensions are versioned differently |
| `block-csmcp-mcp` | Claude MCP server gating; Pi doesn't use MCP |
| `block-standalone-ue-bypass` | Claude-specific standalone mode detection |

### OVERLAP (duplicate logic across Claude hooks — consolidate, don't duplicate)

| Hook A | Hook B | Overlap | Pi resolution |
|--------|--------|---------|---------------|
| `orchestrator-allowlist` | `delegate-bounded-tasks` | Both gate orchestrator inline commands | One `gsd-orchestrator-gate` handler |
| `block-orchestrator-ue-planning` | `orchestrator-allowlist` | UE commands blocked by both | Combine into `gsd-orchestrator-gate` |
| `fix-failure-gate` | `fix-failure-tracker` | Gate reads state that tracker writes | One `gsd-failure-gate` with in-memory state |
| `build-verify-gate` | `build-verify-reminder` | Gate blocks, reminder advises — same rule | One handler, block or advise based on severity |
| `ue-action-dispatch` | `ue-ops-reminder` | Both detect UE intent in user prompts | One `gsd-ue-dispatch` handler |
| `lane-terminal-reconcile` | `lane-terminal-notice` | Both fire on terminal lane state | One lane lifecycle handler |
| `commit-gate` | `doc-chain-check` | Both fire on git commit/push | One `gsd-commit-gate` handler |

### ALREADY HANDLED by Pi / lane infrastructure

| Hook | Where it's already handled | Action |
|------|---------------------------|--------|
| `enforce-provider-diversity` | `gsd_impl_lane.py` wave assignment + `enforce-provider-diversity` in lane spec | Verify lane pipeline, skip Pi extension |
| `enforce-parallel-delegation` | Lane pipeline handles wave dispatch + frontier computation | Verify, skip |
| `task-lane-stamp` | Lane manifest already has provider/model/effort fields | Read from manifest directly |
| `batch-merge-trigger` | Lane pipeline `integrate` command | Verify, skip |
| `post-merge-push-trigger` | Lane pipeline handles push after integration | Verify, skip |
| `lane-terminal-reconcile` | Lane pipeline `reconcile` command exists | Verify, skip |
| `session-lane-sweep` | Lane pipeline cleanup + worktree prune | Move to `session_start`, verify coverage |
| `auto-register-modules` | Pi extension auto-discovery from package.json | Verify, skip |

## Sync Process

### When a Claude hook changes

1. **Identify the Pi group** — find the hook in the consolidation map above
2. **Read the changed hook** — understand what rule changed
3. **Read the Pi extension** — check if it already has equivalent logic
4. **Diff the rule** — is this a new rule, a changed threshold, or a removed rule?
5. **Apply to Pi group** — update the Pi extension, preserving:
   - In-process state (no file I/O where Claude uses file-based state)
   - Combined handlers (don't split back to 1:1)
   - Pi-specific event mapping (tool_call vs tool_result)
   - Any Pi-only optimizations not in Claude
6. **Run E2E tests** — `PI_TEST_MODEL=gpt-5.6-sol PI_TEST_EFFORT=high npm run test:extensions:e2e`
7. **Update PI-MIGRATION.md** — mark the sync in the inventory

### When adding a NEW Claude hook

1. **Classify** — blocker (tool_call → block) or observer (tool_result)?
2. **Find the right Pi group** — or create a new one if no group fits
3. **Write the Pi handler** — follow the group's pattern
4. **Write test fixture** — scope-isolated in `test/extensions/<name>/`
5. **Write E2E fixture** — in `test/extensions/e2e/<name>/`
6. **Update this map** — add the hook to the consolidation table

### Drift detection

```bash
# List Claude hooks without a Pi group assignment
diff <(ls ~/gsd-config/get-shit-done/hooks/*.cjs | xargs -I{} basename {} | sort) \
     <(grep -oP '(?<=\| )[a-z][-a-z0-9_]+(?= )' .planning/HOOK-SYNC.md | sort) \
  | grep "^<"
```

## Fork-Gate Audit (2026-09-17)

All 4 fork-gate rules are COVERED by `gsd_impl_lane.py`. No Pi extension needed.

| Rule | Lane evidence | Assessment |
|------|---------------|------------|
| Concurrency cap | `lane_capacity.py:159` — `max_concurrent_streams`, wait-with-lock | Stricter than fork-ledger |
| Scope isolation | `lane_cmd_run.py:60-63` — mandatory WriteScope, overlap detection | Stricter than require-fork-scope |
| Commit ownership | `lane_commit.py:295+` — pipeline constructs commit, branch isolation | Stricter than block-fork-push |
| Model routing | `lane_providers.py:520-542` — routing with demotion, eligibility, tiers | Stricter than fork-capability-floor |

## Consolidated Pi Extensions (created 2026-09-17)

| Extension | Source hooks | Event | Status |
|-----------|-------------|-------|--------|
| `gsd-orchestrator-gate.ts` | orchestrator-allowlist + block-orchestrator-ue-planning + delegate-bounded-tasks | `tool_call` | Created |
| `gsd-failure-gate.ts` | fix-failure-tracker + fix-failure-gate + failure-pattern-detector | `tool_call` + `tool_result` | Created |
| `gsd-session-init.ts` | gsd-session-selfcheck + task-board-restore + session-lane-sweep + ensure-session-monitor | `session_start` only | Created |

## Metrics baseline (2026-09-17)

| Metric | Claude (process-per-hook) | Pi target (in-process groups) |
|--------|--------------------------|-------------------------------|
| Avg invocation | 426ms | <5ms (no fork) |
| No-op rate | 83.5% | Same rules, faster bail-out |
| Context injections | 2.3% of calls, ~151 tokens avg | Same content, batched |
| Heaviest injector | gsd-session-selfcheck: 294 tokens/call on ALL events | session_start only |
| Process spawns per tool call | Up to 65+ | 0 (in-process) |
