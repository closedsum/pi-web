## Correctness — Score: 3

**Strengths:**
- `uniqueSlug()` (lib/gsd-lane-extension.ts:31-34) correctly appends a random hex suffix to prevent worktree/spec/log path collisions between concurrent dispatches — this closes the "unique slug" finding from the prior review round.
- `ScopeGlobs: params.write_scope || []` (line 125) now always produces an array, closing the prior type-mismatch finding.
- `try { ... } catch (err) { return { ..., isError: true } }` around the `build-queue` call (around line ~150) correctly surfaces failure to the caller with the underlying message.

**Concerns:**
- **HIGH** (lib/gsd-lane-extension.ts:92-93): `const baseSlug = params.slug || slugify(params.task);` only sanitizes the *auto-generated* slug. If the caller supplies `params.slug` explicitly, it is used verbatim (`uniqueSlug(baseSlug)` just appends a suffix, it doesn't sanitize). That raw string is then interpolated into `join(lanesDir, `spec-${slug}.md`)`, `join(worktreeRoot, `pi-${slug}`)`, `lane/${slug}` (git branch name), and multiple other file paths. A slug containing `../`, spaces, or shell/path metacharacters can write files outside `.planning/impl-lanes/` or produce an invalid/unexpected git branch name.
- **MEDIUM** (lib/gsd-lane-extension.ts:100-106): when `git rev-parse HEAD` fails, `head` silently falls back to the literal string `"HEAD"` instead of a pinned SHA. This value is passed straight through as `laneParams.Base` (line 128) — the lane pipeline is documented to pin a base commit for diff/rebase purposes, and a floating ref instead of a SHA changes that semantics with zero diagnostic emitted anywhere.

**Recommendations:**
- Always sanitize: `const baseSlug = slugify(params.slug || params.task);`
- On `git rev-parse` failure, either fail the tool call with a clear error (`isError: true`) or surface a warning in the returned text (e.g. `"Base: HEAD (warning: could not resolve commit SHA)"`) rather than silently substituting a symbolic ref.

## Architecture — Score: 4

**Strengths:** Follows the existing `InlineExtension` / `defineTool` / `factory(pi) => pi.registerTool(...)` pattern already used by `createSubagentExtension` (lib/rpc-manager.ts:32-35), and is registered the same way in the extensions array (lib/rpc-manager.ts:2056).

**Concerns:** None beyond what's captured under Correctness/Robustness.

## Integration — Score: 4

**Strengths:** Two-line, minimal-footprint wiring into `rpc-manager.ts` (import + one array entry), consistent with how other extensions are added.

**Concerns:**
- **LOW**: `createGsdLaneExtension({ cwd: sessionCwd })` (lib/rpc-manager.ts:2056) never passes `gsdBinDir`/`python` overrides, so it always relies on the `HOME`/`USERPROFILE` default (lib/gsd-lane-extension.ts:62-65). If this pi-web instance is ever run somewhere GSD isn't installed under `<home>/gsd-config/get-shit-done/bin`, every dispatch fails at the `build-queue` step with no earlier signal to the user that the extension is essentially non-functional in that environment.

## Safety — Score: 3

**Concerns:** Same as Correctness finding #1 (unsanitized `params.slug` driving filesystem paths and worktree naming) — filesystem-write safety issue, not memory/thread safety (N/A for this Node/TS code).

## Performance — Score: 5
No hot-path or per-frame concerns; this is a one-shot dispatch path with a handful of `execFile`/`spawn` calls.

## Test Quality — Score: 2

**Strengths:** Tests correctly verify tool registration, name/hidden flag, parameter schema presence, and `executionMode` (lib/gsd-lane-extension.test.mjs:14-40).

**Concerns:**
- **HIGH** (lib/gsd-lane-extension.test.mjs, whole file): none of the 5 tests call `tool.execute()`. This changeset's stated purpose is fixing 8 prior review findings — Task ID, SpecFile, spawn error handler, stdio logging, PID capture, unique slug, ScopeGlobs array — nearly all of which live inside `execute()` (lib/gsd-lane-extension.ts:91-204). None of these behaviors are exercised by a test. A regression (e.g., reverting `uniqueSlug`, or reintroducing raw `params.slug`) would pass the full suite.

**Recommendations:** Add at least one test that calls `execute()` against a temp git repo with `execFile`/`spawn` mocked or pointed at stub scripts, and assert: (a) `slug` differs across two calls with the same `task`/`slug` input, (b) `ScopeGlobs` defaults to `[]`, (c) the returned text contains a non-zero `pid`.

## Technical Debt — Score: 4
No TODOs or dead code introduced. Minor duplication noted below.

## API Design — Score: 4
Tool schema, `promptGuidelines`, and description (lib/gsd-lane-extension.ts:73-90) are clear and give the calling agent good steering. Naming (`DispatchLane`, `write_scope`, `skip_review`) is consistent and self-explanatory.

## DRY / Duplication — Score: 3

**Concerns:**
- **MEDIUM**: `resolveWorktreeRoot` (lines 36-46), `resolveModel` (lines 48-59), and the `build-queue` invocation each independently build `execFileAsync(python, [join(gsdBinDir, script), ...args], { timeout })` and wrap it in a try/catch with different failure semantics (silent-default vs. silent-null vs. loud isError). Three copies of essentially the same "invoke a GSD python helper script" pattern.

**Recommendations:** Extract a small `runGsdScript(gsdBinDir, python, script, args, { timeout })` helper that returns `{ ok, stdout, error }`, and let each call site decide how to react to `ok === false` — this also fixes the inconsistency noted below.

## Consistency — Score: 3

**Concerns:**
- **MEDIUM**: within the same file, error handling ranges from fully silent (`catch {}` at line 44, `catch { return null }` at lines 56-58, `catch { head = "HEAD" }` at lines 104-106) to fully explicit (`isError: true` for the `build-queue` failure). This is the inconsistent "check vs. silent return for same criticality" pattern called out by the review dimensions, and it's the concrete instance of the project-wide "never silently swallow errors" rule being violated in three places while being correctly honored in a fourth.

## Simplification — Score: 4
No unnecessary abstraction; the tool logic reads top-to-bottom without indirection.

## Consolidation — Score: 4
No parallel/duplicate subsystems introduced.

## Robustness — Score: 2

**Concerns:** Restates Correctness/Consistency findings — three silent-catch sites (lines 36-46, 48-59, 100-106) degrade functionality (wrong worktree root, no model routing, unpinned base ref) without any diagnostic surfaced to the caller, log, or response text, directly contradicting the project's explicit "never silently swallow errors" mandate.

## Scalability — Score: 5
Single dispatch call per invocation; no per-item loops or registration patterns that would degrade at scale.

---

## Overall Assessment

This changeset does close most of the 8 previously-identified findings — unique slugs, `ScopeGlobs` as an array, PID capture, stdio-to-log-file redirection, and a `SpecFile`/`Task` ID are all now present and mostly correct. The two things holding it back from a clean pass are (1) a real gap in the fix: `params.slug`, when supplied by the caller, bypasses the same `slugify()` sanitization that the auto-generated path goes through, so the "unique slug" fix doesn't fully protect against path-unsafe input; and (2) the test file only validates tool registration/schema shape and never exercises `execute()`, so none of the 8 claimed fixes actually have regression protection. Combined with three silent-catch blocks that quietly substitute defaults (worktree root, model, and — most consequentially — the pinned base commit) with zero diagnostic, this is functional but not yet at the reliability bar the surrounding project conventions call for.

## Top 3 Priorities

1. **Sanitize `params.slug` unconditionally** (lib/gsd-lane-extension.ts:92) — one-line fix, closes a real path-safety gap, highest impact/effort ratio.
2. **Add `execute()`-level tests** covering slug uniqueness, `ScopeGlobs` defaulting, and PID capture (lib/gsd-lane-extension.test.mjs) — protects the very fixes this PR claims to deliver.
3. **Surface the three silent catches** (lines 44, 56-58, 104-106) as logged warnings or `_error`-style diagnostics, especially the `git rev-parse HEAD` fallback that silently weakens the `Base` pin used for lane isolation.

## Risk Assessment: MEDIUM

Nothing here is a crash or data-loss bug, but the unsanitized-slug path-write issue and the untested claimed-fixes combination mean a subsequent regression or a maliciously/accidentally crafted `slug` value could go undetected and land outside the intended `.planning/impl-lanes/` sandbox.

## Findings JSON

```json
[
  {
    "severity": "HIGH",
    "title": "Caller-supplied slug bypasses sanitization, enabling path traversal",
    "file": "lib/gsd-lane-extension.ts",
    "line": 92,
    "category": "safety",
    "description": "`const baseSlug = params.slug || slugify(params.task);` only sanitizes the auto-generated slug. When `params.slug` is provided, it is used raw (only a random suffix is appended by uniqueSlug), then interpolated into file paths (spec/params/queue/log files under .planning/impl-lanes/), a worktree directory name, and a git branch name (`lane/${slug}`). A slug containing `../`, path separators, or shell-unsafe characters can write outside the intended directory or produce an invalid git ref.",
    "recommendation": "Sanitize unconditionally: `const baseSlug = slugify(params.slug || params.task);` so both paths go through the same character allowlist."
  },
  {
    "severity": "HIGH",
    "title": "Silent catch blocks swallow failures on worktree/model/HEAD resolution",
    "file": "lib/gsd-lane-extension.ts",
    "line": 44,
    "category": "robustness",
    "description": "Three call sites (resolveWorktreeRoot line 44, resolveModel lines 56-58, and the git rev-parse HEAD fallback lines 104-106) catch and silently discard errors, substituting defaults with no log entry or diagnostic. The HEAD fallback is most consequential: on failure `Base` is set to the literal string \"HEAD\" instead of a pinned commit SHA, which is then sent to the lane pipeline as `laneParams.Base` (line 128), silently changing base-pinning semantics for the lane's diff/integration step.",
    "recommendation": "Log the caught error (e.g. write to the lane's log file or append a warning line to the tool's returned text) instead of an empty/silent catch, and consider failing the tool call outright when `git rev-parse HEAD` fails, since Base is used for lane isolation correctness."
  },
  {
    "severity": "HIGH",
    "title": "No test exercises execute() — the 8 claimed fixes are untested",
    "file": "lib/gsd-lane-extension.test.mjs",
    "line": 1,
    "category": "testing",
    "description": "All 5 tests check tool registration, name/hidden flag, parameter schema shape, and executionMode. None invoke `tool.execute()`, so unique-slug generation, ScopeGlobs defaulting, PID capture, spawn error handling, and log-file writing — the exact behaviors this PR claims to fix — have zero regression coverage.",
    "recommendation": "Add a test that mocks execFile/spawn (or points gsdBinDir/python at stub scripts) and calls execute() to assert: two calls with identical task/slug produce different slugs, ScopeGlobs defaults to [], and the response text contains a non-zero pid."
  },
  {
    "severity": "MEDIUM",
    "title": "Task ID uses Date.now(), collidable under parallel execution",
    "file": "lib/gsd-lane-extension.ts",
    "line": 116,
    "category": "correctness",
    "description": "`const taskId = Date.now();` is used as the lane's Task ID. The tool declares `executionMode: \"parallel\"` (line 83), meaning multiple DispatchLane calls can be in flight concurrently; two calls resolving within the same millisecond receive identical Task IDs, which the task panel displays as `#id` per the RESUME doc, causing UI/task-board ambiguity.",
    "recommendation": "Derive the Task ID from the already-unique `slug` (e.g. a hash of it) or combine Date.now() with the same random suffix used in uniqueSlug()."
  },
  {
    "severity": "MEDIUM",
    "title": "Duplicated execFileAsync-python-script invocation pattern across three call sites",
    "file": "lib/gsd-lane-extension.ts",
    "line": 36,
    "category": "dry",
    "description": "resolveWorktreeRoot (lines 36-46), resolveModel (lines 48-59), and the build-queue invocation each independently construct `execFileAsync(python, [join(gsdBinDir, script), ...args], { timeout })` with their own try/catch and different failure semantics (silent-default, silent-null, loud isError), making error-handling policy inconsistent across near-identical code.",
    "recommendation": "Extract a shared `runGsdScript(gsdBinDir, python, script, args, opts)` helper returning `{ ok, stdout, error }`, and have each call site apply a single, consistent policy for reacting to failure."
  }
]
```
