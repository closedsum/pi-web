# Test Matrix

## Running Tests

```bash
npm test                          # all tests (uses --test-skip-pattern for API route dirs)
node --test lib/<file>.test.mjs   # single file
node --test components/           # all component tests
```

## Baseline

1151 tests, 1149 pass, 0 fail, 2 skipped (session 3, 2026-09-17).

## Test Organization

Tests are colocated with source files as `<name>.test.mjs`. Uses Node.js built-in test runner with `jiti` for TypeScript imports.

| Directory | Scope | Count |
|-----------|-------|-------|
| `app/api/` | API route handlers (sessions, agent, files, plugins, auth) | ~40 |
| `components/` | React component rendering (SSR via JSDOM shim) | ~700 |
| `hooks/` | React hooks (useAgentSession, model loading/switching) | ~200 |
| `lib/` | Utility libraries (worktree, terminal, RPC, trust, env) | ~200 |
| `public/` | Service worker (push notifications) | ~10 |

## Test Patterns

### Source reading tests

Many tests read their source file to verify structure (no `style={{`, correct imports, etc.). **CRLF normalization is required** — add `.replace(/\r\n/g, "\n")` to `readFile` calls that match against `\n` patterns. All 33 test files were normalized in session 3.

### Component tests

Use a `renderToString` shim (`lib/test-render.mjs`) that produces HTML strings for assertion. No browser DOM — tests verify HTML structure and inline styles.

### jiti module dedup

Import paths must match exactly between test and source. `"@/lib/draft-store.ts"` (with extension) and `"@/lib/draft-store"` (without) create separate module instances with separate `Map` objects.

## Known Skips

2 tests skipped (platform-specific, not failures):
- One CRLF-related skip
- One platform-conditional skip

## Adding Tests

1. Create `<name>.test.mjs` next to the source file
2. Import with `createJiti(import.meta.url).import("./source.ts")`
3. Use `node:test` and `node:assert/strict`
4. Each test gets fresh fixture objects (scope isolation)
5. Run with `node --test <file>.test.mjs` to verify
6. Full suite: `npm test` before commit
