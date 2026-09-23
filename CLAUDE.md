## Project

**Pi Web** — Web UI for the Pi coding agent (`@agegr/pi-web`).

Next.js app that hosts coding-agent sessions for user-selected projects, with a task panel, model selector, file explorer, terminal, and extension system.

## Technology Stack

- **Framework:** Next.js (App Router), React, TypeScript
- **Node:** >=22.19.0
- **Test runner:** `node --experimental-strip-types --test` with `.test.mjs` files
- **Package:** `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server at `127.0.0.1:30141` |
| `npm test` | Run all unit tests (co-located `.test.mjs` files) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test:e2e` | End-to-end tests |
| `npm run test:py` | Python unit tests for e2e helpers (`test/e2e/test_*.py`) |
| `python test/e2e/cropout-ue-chain.py` | Live UE chain via pi-web; fails a step if its UE dispatch fails or finishes out of send order (logs checked via `test/e2e/ue_dispatch_outcome.py`) |

## Conventions

- **Co-located tests:** Each `lib/<module>.ts` has a `lib/<module>.test.mjs` alongside it
- **Test imports:** Use the `loadSubject()` pattern with jiti fallback for TypeScript imports:
  ```js
  async function loadSubject() {
    try {
      const { createJiti } = await import("jiti");
      return createJiti(import.meta.url).import("./<module>.ts");
    } catch { return import("./<module>.ts"); }
  }
  ```
- **Test model:** `test/test-model.json` is the single source for the provider/model/effort that extension and e2e tests run against (read by `test/extensions/_config.mjs` and `test/e2e/orchestrator-e2e.py`); override per run with `PI_TEST_PROVIDER` / `PI_TEST_MODEL` / `PI_TEST_EFFORT`. GPT tier IDs in tests come from `lib/model-display.json` via `test/extensions/_models.mjs`
- **Client components:** Mark with `"use client"` directive
- **Path aliases:** `@/` maps to project root (e.g., `@/lib/model-registry`)

## Key Modules

| Module | Purpose |
|--------|---------|
| `lib/model-display.json` | Single-source config for model families, colors, display names — edit this file to add models |
| `lib/model-registry.ts` | Derives exports from model-display.json: `getModelFamily()`, `getModelFamilyColor()`, `resolveModelDisplayName()` |
| `lib/task-board.ts` | Reads `.planning/threads/board.jsonl` task board data |
| `lib/model-catalog.ts` | Provider model catalog (discovery, presets) |
| `lib/model-scope.ts` | Resolves visible models from `enabledModels` whitelist |
| `lib/dispatch-status.ts` | Reads lane pipeline manifests (`cwd/.planning/impl-lanes/p-*.json`) and UE dispatch progress into unified `DispatchItem[]` |
| `app/api/dispatch-status/route.ts` | API route serving dispatch data — calls `readAllDispatches(cwd)` with no session filtering |
| `components/task-panel/TaskPanel.tsx` | Task panel with color-coded model/effort/tasktype tags; passes `key={cwd:sessionId}` to DispatchSection |
| `components/task-panel/DispatchSection.tsx` | Lanes section — filters pre-existing terminal lanes via baseline snapshot; resets on fetch-recovery (server restart) |
| `components/ModelSelector.tsx` | Model dropdown with per-provider color coding |

## Orchestrator Mode

`lib/gsd-lane-extension.ts` enforces orchestrator mode via `pi.on("tool_call")` allow-list gate. The model can only use read-only tools + dispatch tools. All other tools (bash, powershell, write, edit) are blocked mid-turn.

**Dispatch tool contract** — any tool that dispatches long-running work must:
1. **Fire-and-forget:** spawn the process detached, return within 1s
2. **Single call:** one dispatch per request — no decompose→dispatch→verify chains
3. **Allow-listed:** added to `ORCH_ALLOW` in `gsd-lane-extension.ts`
4. **Prompt guideline:** includes "call once, dispatcher handles everything internally"

Current dispatch tools: `DispatchLane`, `ue_dispatch`
Current status tools: `CheckLaneStatus` — deterministic JSON from lane manifests

## Architecture

- **Host vs Project:** Pi Web's runtime environment is separate from the project command environment (see `CONTEXT.md`)
- **Extensions:** Plugin system via `lib/sidebar-extensions/` and RPC manager
- **Settings:** User prefs in `~/.pi/agent/settings.json`, layout prefs in localStorage via `hooks/useLayoutPreferences.ts`
- **Models:** Configured in `~/.pi/agent/models.json`, filtered by `enabledModels` in settings

## Subordinate Docs

| Topic | File |
|-------|------|
| **Doc Chain Index** | [`docs/INDEX.md`](docs/INDEX.md) — full doc tree: UI framework, extensions, settings, test matrix, ADRs |
| **Host vs Project** | [`CONTEXT.md`](CONTEXT.md) — runtime isolation between web server and project commands |
| **Dev Notes** | [`AGENTS.md`](AGENTS.md) — development quick-start and agent configuration |
