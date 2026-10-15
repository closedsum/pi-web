# Testing

## Framework

- **Node.js built-in test runner:** `node --experimental-strip-types --test`
- **Assertion:** `node:assert/strict`
- **Test files:** `.test.mjs` (ESM JavaScript, not TypeScript)
- **TypeScript imports in tests:** via `jiti` dynamic import (see loadSubject pattern below)

## Test Categories

### Unit Tests (`npm test`)
Co-located with source files:
- `lib/<module>.test.mjs` — library module tests
- `components/<Component>.test.mjs` — component logic tests (no DOM rendering)
- `app/api/<route>/test/*.test.mjs` — API route tests

**Run command:** `npm test` (skips `app/api/*/test/` subdirectories by default)

### Extension Tests (`npm run test:extensions`)
Scope-isolated hook tests in `test/extensions/<hook-name>/`:
- Each directory tests one hook from gsd-config
- Uses shared harness: `test/extensions/_config.mjs` (test model, event factories, assertions)
- Real hooks loaded via `test/extensions/_hooks.mjs` (reads actual gsd-config hooks)
- **592 tests** across 70+ test files

### E2E Tests (`npm run test:e2e`)
Playwright browser tests in `e2e/`:
- `e2e/run.mjs` — orchestrator: starts server, seeds fixtures, runs all checks
- Fixture sessions with 5000 messages, branching, compaction, tool calls
- Desktop (1280px) and mobile (390px) viewports
- Headless by default; `E2E_HEADED=1` for visible Chrome window
- Tests: pagination, scroll restoration, markdown rendering, extension dialogs, session navigation

### Python E2E Tests (`npm run test:py`)
Python test helpers for UE dispatch chain testing:
- `test/e2e/run_unittests.py` — runner
- `test/e2e/test_*.py` — individual test files

## Test Patterns

### loadSubject Pattern
TypeScript modules imported in `.test.mjs` via jiti:
```js
async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./<module>.ts");
  } catch { return import("./<module>.ts"); }
}
```

### Extension Test Harness
`test/extensions/_config.mjs` provides:
- `makeToolCallEvent(toolName, args)` — creates mock tool call events
- `makeBashToolCallEvent(command)` — shorthand for Bash commands
- `assertBlocked(result, pattern)` — asserts a block with reason matching
- `assertPassed(result)` — asserts no block
- `TEST_CONFIG` — resolved from `test/test-model.json` with env overrides

### Hook Test Pattern
`test/extensions/_hooks.mjs` loads real gsd-config hooks:
- `loadHook(hookName, exports)` — loads `.cjs` hook, extracts named exports
- `hookTestFor(hook)` — returns test function that skips if hook unavailable
- Model tables derived from real hooks (no hardcoded model IDs)

## Test Model Configuration

`test/test-model.json`:
```json
{ "provider": "...", "model": "...", "effort": "..." }
```
Overridable per-run: `PI_TEST_PROVIDER`, `PI_TEST_MODEL`, `PI_TEST_EFFORT`

## Coverage

- No formal coverage tool configured
- Extension tests cover all 21 block rules + 49 hook-based extensions
- E2E tests cover: pagination, scroll, branches, markdown, tools, compaction, sessions, dialogs, fonts, model discovery, code backgrounds
- Unit tests cover: model registry, task board, dispatch status, session readers, file security
