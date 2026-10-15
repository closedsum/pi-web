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
| `npm run test:py` | Python unit tests for e2e helpers (`test/e2e/test_*.py`) via `test/e2e/run_unittests.py`; any error/failure also writes a full traceback report under `<tempdir>/pi-web-test-py/` and prints its path |
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
- **Test model:** `test/test-model.json` is the single source for the provider/model/effort that extension and e2e tests run against (read by `test/extensions/_config.mjs` and `test/e2e/orchestrator-e2e.py`); override per run with `PI_TEST_PROVIDER` / `PI_TEST_MODEL` / `PI_TEST_EFFORT`. Hook-port tests take model tables from the real gsd-config hooks via `test/extensions/_hooks.mjs` (no model IDs hardcoded)
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
| `lib/extensions/` | Modular pi extension framework — tool blockers, shared test harness, composable rules |
| `lib/extensions/tool-blockers.ts` | 23 `BlockRule` pure functions ported from Claude PreToolUse hooks; `evaluateBlockRules()` |
| `lib/extensions/_test-harness.mjs` | `createMockPi()`, `assertBlocks()`, `assertAllows()` for extension dry-run testing |

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
- **Extensions:** Sidebar actions via `lib/sidebar-actions.ts` and `lib/sidebar-prefs.ts`
- **Settings:** User prefs in `~/.pi/agent/settings.json`, layout prefs in localStorage via `hooks/useLayoutPreferences.ts`
- **Models:** Configured in `~/.pi/agent/models.json`, filtered by `enabledModels` in settings

## Subordinate Docs

| Topic | File |
|-------|------|
| **Doc Chain Index** | [`docs/INDEX.md`](docs/INDEX.md) — full doc tree: UI framework, extensions, settings, test matrix, ADRs |
| **Host vs Project** | [`CONTEXT.md`](CONTEXT.md) — runtime isolation between web server and project commands |
| **Dev Notes** | [`AGENTS.md`](AGENTS.md) — development quick-start and agent configuration |

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Pi Web**

Web UI for the Pi coding agent — a full-stack Next.js application that hosts coding-agent sessions with chat, terminal, file explorer, model selector, task panel, and a modular extension system. Used by a single developer to run GSD-orchestrated coding sessions through a browser interface instead of the CLI.

**Core Value:** Agent sessions execute with the same safety rules and orchestration enforcement as the CLI — no tool call bypasses the extension system.

### Constraints

- **Runtime:** Node.js >=22.19.0 with `--experimental-strip-types`
- **Framework:** Next.js 16 App Router — no Pages Router
- **SDK:** Must use `@earendil-works/pi-*` v1.2.0 APIs for session and extension management
- **Extensions:** Block rules must be pure functions in `tool-blockers.ts` with the existing `BlockRule` signature
- **Testing:** Co-located `.test.mjs` files using `node --test` with jiti fallback for TS imports
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

> **Reference:** Read [`.planning/codebase/STACK.md`](.planning/codebase/STACK.md) before making stack-level decisions (adding plugins, adopting libraries, changing frameworks). Sections: Languages & Runtime, Framework, Core Dependencies, Dev Dependencies, Configuration Files, Runtime Configuration.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

> **Reference:** Read [`.planning/codebase/CONVENTIONS.md`](.planning/codebase/CONVENTIONS.md) before writing new assets, tests, or code that must follow project conventions. Sections: TypeScript, React Patterns, Component Organization, Extension System, Error Handling, Naming, Imports, CSS.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

> **Reference:** Read [`.planning/codebase/ARCHITECTURE.md`](.planning/codebase/ARCHITECTURE.md) for architecture documentation. Sections: Pattern, Layers, Data Flow, Key Abstractions, Entry Points.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small NON-bug tasks (docs, config, cleanup)
- `/gsd:bug-fix` for broken behavior of any size (deterministic loop with cross-review)
- `/gsd:debug` for investigation when the cause is unknown (hands off to bug-fix once diagnosed)
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
