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
| `components/task-panel/TaskPanel.tsx` | Task panel with color-coded model/effort/tasktype tags |
| `components/ModelSelector.tsx` | Model dropdown with per-provider color coding |

## Architecture

- **Host vs Project:** Pi Web's runtime environment is separate from the project command environment (see `CONTEXT.md`)
- **Extensions:** Plugin system via `lib/sidebar-extensions/` and RPC manager
- **Settings:** User prefs in `~/.pi/agent/settings.json`, layout prefs in localStorage via `hooks/useLayoutPreferences.ts`
- **Models:** Configured in `~/.pi/agent/models.json`, filtered by `enabledModels` in settings
