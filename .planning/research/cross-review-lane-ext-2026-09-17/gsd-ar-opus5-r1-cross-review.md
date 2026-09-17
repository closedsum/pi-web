# Cross-AI Code Review — GSD Lane Dispatch Extension v2

Reviewed: `lib/gsd-lane-extension.ts` (new, 204 lines), `lib/gsd-lane-extension.test.mjs` (new, 49 lines), `lib/rpc-manager.ts` (+2), `.planning/threads/RESUME-PI-WEB-UI.md` (new doc).

---

## 1. Correctness — **Score: 2**

**Strengths**
- `uniqueSlug()` (`gsd-lane-extension.ts:31-34`) correctly handles the empty-base case (`lane-${suffix}`), so an all-non-ASCII task description still yields a valid slug rather than a bare `-abc123`.
- `resolve(options.cwd)` at line 94 normalizes the repo path before it is embedded in `laneParams.Repo`, so a relative session cwd does not leak into the lane params file.
- `Base: head` pins the lane to a concrete commit in the normal path (line 102-103), which is the right determinism choice.

**Concerns**

- **HIGH — spawn failure is reported to the user as success.** Lines 161-191: `spawn()` is asynchronous; a missing `python` or missing `gsd_impl_lane.py` surfaces via the `'error'` event *after* `execute()` has already returned. The return block at line 183 runs unconditionally, so the agent tells the user `Lane dispatched: my-slug (pid 0)` and the chat reports success while nothing is running. The only record of the real failure is a line appended to `log-<slug>.txt` that nothing reads. `const pid = child.pid || 0` (line 173) papers over exactly the signal that would have caught this — `child.pid` is `undefined` precisely when the spawn failed.
- **MEDIUM — silent fallback to a floating `HEAD`.** Lines 100-106: if `git rev-parse HEAD` fails (git not on PATH, unborn branch in a fresh repo, permission error), `head` becomes the literal string `"HEAD"`, which is then sent as `laneParams.Base`. The lane worktree is then created off whatever `HEAD` points at when the lane actually starts — which, given `executionMode: "parallel"` and detached background execution, can be many commits later than the dispatch point. The status text also degrades to `Base: HEAD` (line 188, `head.slice(0, 8)`), which reads as a valid short SHA to a human skimming the output.
- **LOW — empty `Title` for tasks starting with a delimiter.** Line 122: `params.task.split(/[.\n]/)[0].slice(0, 80)` returns `""` when the task begins with `.` or a newline (e.g. `".github/workflows: fix the cache key"` → first segment is `""`). The commit message title becomes empty.

**Recommendations**
- Gate the return on spawn success: capture `if (child.pid === undefined) return { ..., isError: true }`, and additionally race a one-tick `'error'` listener before returning (`await new Promise(r => { child.once('spawn', r); child.once('error', r); })`), returning `isError: true` with `err.message` in the text.
- Make git resolution fatal: if `rev-parse` fails, return `isError: true` naming the repo path, rather than substituting `"HEAD"`.
- `params.title || slugify(params.task) || slug` for the title fallback.

---

## 2. Architecture — **Score: 3**

**Strengths**
- Clean separation: the extension owns only param-file construction and process launch; all lane semantics stay in `gsd_impl_lane.py`. No GSD logic was reimplemented in TypeScript.
- `GsdLaneExtensionOptions` (lines 17-21) makes `gsdBinDir`/`python` injectable, which is what makes the module testable at all.

**Concerns**

- **HIGH — the extension is registered unconditionally with no availability gate, and it carries a behavior-overriding prompt.** `rpc-manager.ts:2056` adds `createGsdLaneExtension({ cwd: sessionCwd })` to the extension list with no flag, while its immediate neighbor at line 2054 is gated by `isBuiltInSubagentsEnabled`. Because `gsdBinDir` defaults to `$HOME/gsd-config/get-shit-done/bin` (lines 62-65), every pi-web session on a machine without GSD installed now gets a `DispatchLane` tool whose `promptGuidelines[0]` states *"never run Edit/Write inline when a lane can do it"* (line 78). The model follows that instruction, calls `DispatchLane`, `build-queue` fails on a nonexistent script, and the user gets a lane-queue error instead of the edit they asked for. This is a behavioral regression for every non-GSD session, not just a no-op.
- **MEDIUM — the module hard-codes GSD file layout in three places** (`gsd-config.py` at line 39, `gsd_impl_lane.py` at lines 51 and 148/162) with no single constant and no existence check at construction time.

**Recommendations**
- Probe once in `createGsdLaneExtension` (e.g. `existsSync(join(gsdBinDir, "gsd_impl_lane.py"))`) and return an extension that registers nothing when GSD is absent — or gate registration in `rpc-manager.ts` behind the same style of `isXEnabled` predicate used for subagents.
- Soften `promptGuidelines[0]` to be conditional ("when the task will edit files *in this repo* and a lane is available") so a lane failure does not strand the session.

---

## 3. Integration — **Score: 2**

**Strengths**
- The wiring in `rpc-manager.ts` is minimal and correct — import at line 35, one array entry, `sessionCwd` threaded as `cwd`, matching the surrounding extensions' construction style.
- `SpecFile` is an absolute path (line 113/124), so the lane reading it from a separate worktree still resolves it.

**Concerns**

- **MEDIUM (UNVERIFIED-CONTRACT) — `Task: Date.now()` is a synthetic ID with no producer-side basis.** Line 116/120. `gsd_impl_lane.py` is not in the review material, so I cannot confirm what it does with `Task`. Two concrete risks stand regardless: (a) two dispatches inside the same millisecond produce identical Task IDs while the slugs differ, and (b) the stated integration goal is *"task panel shows lane progress"* via `.planning/threads/board.jsonl`, whose records use small `#id` numbers (per `RESUME-PI-WEB-UI.md` line "…`#id` task numbers prepended"). A 13-digit epoch value will not join against any board row, so the task panel shows nothing for dispatched lanes.
- **MEDIUM (UNVERIFIED-CONTRACT) — `ScopeGlobs: params.write_scope || []`** (line 125). An empty array and an absent key are different signals to most scope enforcers: `[]` commonly means "no path matches → no writes permitted" (fail-closed), while omission means unrestricted. Since `write_scope` is optional and the prompt never requires it, the common case dispatches every lane with `ScopeGlobs: []`. If the producer fails closed, every default lane produces zero commits against `ExpectedCommits: 1`.
- **MEDIUM — the same task text is written three ways with no stated precedence.** `Message: params.task` (line 123) and `SpecFile: specPath` (line 124, file content `# title\n\n${params.task}`) encode identical information; `Title` derives from it again (line 122). Whichever one the lane actually consumes, the other two are dead weight that will silently diverge the moment either format changes.

**Recommendations**
- Read `gsd_impl_lane.py`'s params schema and either (a) source `Task` from `gsd_board.py` so the panel can correlate, or (b) drop `Task` if it is optional. Do not invent IDs.
- Omit `ScopeGlobs` entirely when `write_scope` is undefined: `...(params.write_scope ? { ScopeGlobs: params.write_scope } : {})`.
- Pick one of `Message` / `SpecFile` and delete the other.

---

## 4. Safety — **Score: 2**

**Concerns**

- **HIGH — model-supplied `slug` flows unsanitized into filesystem paths and a git ref.** Line 92: `const baseSlug = params.slug || slugify(params.task);` — the *task-derived* path goes through `slugify()`, but the explicit `params.slug` parameter does not. The value then reaches `join(worktreeRoot, \`pi-${slug}\`)` (97), `lane/${slug}` (98), `join(lanesDir, \`spec-${slug}.md\`)` (113), `p-${slug}-params.json` (141), `q-${slug}.json` (144) and `log-${slug}.txt` (158). A slug of `../../../.ssh/authorized_keys` or `..\\..\\config` escapes `.planning/impl-lanes/` and `writeFile` clobbers the target — the spec file content is fully model-controlled. The parameter description ("Short kebab-case identifier") is documentation, not enforcement. The random hex suffix does not help: `../../foo-a1b2c3` traverses just as well.
- **MEDIUM — `FileHandle.fd` handed to `stdio` with a racy close.** Lines 159-180: the `'error'` handler writes then closes, and the `'exit'` handler closes independently. Node does not guarantee `'exit'` after a spawn `'error'`, and when both fire the write can land after the close — `EBADF`, swallowed by `.catch(() => {})`. So the one diagnostic for a failed spawn is itself best-effort. Additionally, holding a `FileHandle` in the parent for the entire lifetime of a long-running autonomous lane keeps a parent-side descriptor open for hours per dispatch.

**Recommendations**
- `const slug = uniqueSlug(slugify(params.slug || params.task));` — one-line fix, sanitizes both sources.
- Close the handle immediately after `spawn()` returns (the child already holds its own dup'd descriptor) and log spawn errors through the session logger instead of the file handle.

---

## 5. Performance — **Score: 5**

No hot path. Two sequential ~10s-timeout subprocess calls (`resolveWorktreeRoot` line 96, `resolveModel` line 108) run per dispatch; they are independent and could be `Promise.all`'d, but dispatch is user-initiated and infrequent — not worth flagging.

---

## 6. Test Quality — **Score: 2**

**Strengths**
- The jiti-based loader (`gsd-lane-extension.test.mjs:5`) lets a `.mjs` test consume the TS module without a build step, and `loadTools()` (7-15) is a reasonable minimal `pi` harness.

**Concerns**

- **HIGH — zero coverage of `execute()`, which is 100% of the risk surface.** All five tests (lines 17-48) assert registration metadata: tool name, extension name/hidden, presence of five schema properties, and `executionMode`. Nothing exercises slug sanitization, the git-failure branch, the build-queue failure path, the params-file shape, or the spawn arguments. Every HIGH finding in this review sits in code no test touches.
- **HIGH — `"extension uses provided gsdBinDir"` (lines 44-48) is tautological.** It passes `gsdBinDir: "/custom/bin"` and then asserts `assert.ok(ext, "extension should accept custom gsdBinDir")` — `createGsdLaneExtension` always returns an object literal, so this assertion cannot fail regardless of whether `gsdBinDir` is honored or silently ignored. It is a green test that verifies nothing, which is worse than no test because it reads as coverage.
- **MEDIUM — schema tests assert presence, not shape.** `assert.ok(props.write_scope)` (line 32) passes whether `write_scope` is an array of strings or a bare string; the "ScopeGlobs array" fix from the prior review round is therefore unverified by the test that ostensibly covers it.

**Recommendations**
- Inject `python`/`gsdBinDir` pointing at a stub script (a tiny `.py` or a shell shim under a temp dir) and assert on the written `p-<slug>-params.json`: that `ScopeGlobs` is an array, that `Base` is a 40-char SHA, that a traversal slug is neutralized, and that `SpecFile` resolves under `lanesDir`.
- Replace the tautological test with one that asserts the resolved binary path, e.g. by stubbing `execFile` or by asserting the error message from a dispatch against a nonexistent `gsdBinDir` contains `/custom/bin`.

---

## 7. Technical Debt — **Score: 3**

**Concerns**

- **MEDIUM — unbounded artifact accumulation inside the repo, never cleaned.** Every dispatch writes four files into `<repo>/.planning/impl-lanes/`: `spec-<slug>.md` (113), `p-<slug>-params.json` (141), `q-<slug>.json` (144), `log-<slug>.txt` (158). Nothing deletes them — not on success, not on failure, not on a retention schedule. Because the slug now carries a random suffix, re-dispatching the same task never overwrites; it adds four more files. These are untracked files in the working tree of the repo the lane is about to commit to, so a lane with a permissive scope can commit its own dispatch metadata (including the full task text) into the user's history.
- **LOW — `details: undefined` written explicitly at lines 155 and 192** rather than omitted, in both return shapes.

**Recommendations**
- Write dispatch artifacts under `join(tmpdir(), "pi-lanes", slug)` (consistent with the worktree-root fallback at line 45) instead of inside the repo, or add `.planning/impl-lanes/` to a cleanup sweep keyed on lane completion.

---

## 8. API Design — **Score: 3**

**Strengths**
- The tool description and `promptGuidelines` (lines 75-82) are concrete and actionable — they tell the model *when* to reach for the tool, not just what it does.
- Parameter descriptions carry examples (`['lib/**', 'components/**']`, line 87), which materially improves model compliance.

**Concerns**

- **MEDIUM — snake_case tool params (`write_scope`, `skip_review`) sit directly beside PascalCase lane params (`ScopeGlobs`, `SkipReview`) with a hand-written mapping table at lines 118-139.** The mapping is invisible from either side: nothing links `write_scope` → `ScopeGlobs` except line 125, so a rename on the Python side fails silently at runtime with no type error. See also the triple-encoding of task text under Integration.
- **MEDIUM — `skip_review` is exposed to the model with only prose guarding it** ("for trivial changes only", line 89). The model decides unilaterally whether to skip cross-review; there is no session-level policy override. Given the project contract makes cross-review mandatory before accumulating changes, a model-controlled bypass is a governance gap.

**Recommendations**
- Declare the lane-params mapping as a typed `const` object (`{ write_scope: "ScopeGlobs", skip_review: "SkipReview" }`) so the two vocabularies are stated once and can be asserted in a test.
- Make `skip_review` honor a construction-time option (`allowSkipReview?: boolean`, default `false`) that ignores the model's request when disabled.

---

## 9. DRY / Duplication — **Score: 3**

**Concerns**

- **MEDIUM — three copies of the "invoke a GSD python script" pattern.** `resolveWorktreeRoot` (lines 37-45), `resolveModel` (lines 49-58) and the build-queue call (lines 146-156) all construct `execFileAsync(python, [join(gsdBinDir, "<script>.py"), ...args], { timeout })`. The first two are near-identical 8-line bodies differing only in script name, argv tail, and how the result is parsed. They also carry independently-written timeouts (`10_000`, `10_000`, `30_000`) and three *different* error policies (swallow-and-default, swallow-and-null, return-isError).

**Recommendation**
- Extract `async function runGsd(script: string, args: string[], opts: { cwd?: string; timeout?: number })` returning `{ ok: true, stdout } | { ok: false, error }`. All three call sites collapse to one line each and the error policy becomes an explicit per-caller decision on the result, not a hidden property of the helper.

---

## 10. Consistency — **Score: 3**

**Concerns**

- **MEDIUM — three incompatible error policies inside a single `execute()`.** Line 111 (`mkdir`), 114 and 142 (`writeFile`), and 159 (`open`) are unguarded and throw raw out of the tool handler; lines 146-156 (`build-queue`) catch and return a structured `isError: true`; lines 44/56/104 swallow entirely and substitute a default. A disk-full or permission error on `.planning/` therefore surfaces completely differently from a build-queue error, and a config-resolution error surfaces not at all. A reader cannot predict which failures are visible.

**Recommendation**
- Wrap the whole `execute()` body in one `try/catch` that returns the same `{ content: [...], isError: true }` shape used at line 155, then remove the inner ad-hoc catch.

---

## 11. Simplification — **Score: 4**

The module is appropriately flat — no class hierarchy, no unnecessary indirection, `execute()` reads top-to-bottom as a linear procedure. `uniqueSlug`/`slugify` are correctly split (one sanitizes, one disambiguates) rather than fused into a single overloaded helper. No finding.

---

## 12. Consolidation — **Score: 4**

No parallel implementation was introduced; lane orchestration remains solely in `gsd_impl_lane.py` and this file is a thin launcher. The one duplication worth merging is covered under DRY (finding on `runGsd`). No separate finding.

---

## 13. Robustness — **Score: 2**

**Concerns**

- **HIGH — empty `catch {}` blocks silently substitute wrong values into caller-visible results.** `resolveWorktreeRoot` line 44 discards the exception and returns `join(tmpdir(), "pi-lanes")`; `resolveModel` line 56-58 returns `null`, after which the `if (resolved)` guard at line 134 quietly omits `Provider`/`Model`/`Effort` from the lane params. The user sees a success message with no `Model:` line (line 189 filters the empty string out) and no indication that model routing failed — indistinguishable from a build where routing was intentionally left to defaults. This directly violates the project contract: *"Never silently swallow errors… Bare `except: pass` on operations that produce caller-visible values is forbidden. If partial results are acceptable, include both the fallback value and the error so the caller can distinguish 'real zero' from 'failed to read.'"*
- **HIGH — no durable record of the dispatched process; exit code discarded.** The PID exists only in transient chat text (line 185), and `child.on("exit", () => { logFd.close() })` (lines 178-180) ignores the exit code and status entirely. Nothing writes PID, start time, or exit status to disk. The machine contract requires managed Windows Python children to retain *"stdout, stderr, PID, exit code, and whole-tree termination evidence"* — stdout/stderr are captured to the log, but PID and exit code are not, so an orphaned detached lane cannot be located or swept, and no caller can ever learn whether the lane succeeded.

**Recommendations**
- Return the error text alongside the fallback: `resolveWorktreeRoot` → `{ root, error?: string }`, surfaced as a `Warning:` line in the tool output.
- Write `join(lanesDir, \`pid-${slug}.json\`)` with `{ pid, slug, startedAt, queuePath }` immediately after spawn, and update it with `{ exitCode, signal, endedAt }` in the `'exit'` handler.

---

## 14. Scalability — **Score: 3**

Covered by the artifact-accumulation finding (Technical Debt). At the project's stated cadence — a lane per code-touching request, with `promptGuidelines` steering *every* edit through `DispatchLane` — `.planning/impl-lanes/` grows by four files per user request with no ceiling and no index. At a few hundred dispatches the directory becomes the slowest thing any tool globbing `.planning/**` touches. No separate finding.

---

## Overall Assessment

The shape of this change is right: a thin TypeScript launcher that defers all lane semantics to `gsd_impl_lane.py`, injected cleanly into the existing extension list. The v2 round demonstrably closed the mechanical findings it set out to close — PID is captured, slugs are uniquified, `ScopeGlobs` is an array, a spawn error handler exists, stdio is redirected to a file. What it did not close is the *class* of problem those findings belonged to: the module still reports success it has not verified, still substitutes silent defaults for failed lookups, and still trusts model-supplied input as a filesystem path.

The three issues that should block merge are the unsanitized `params.slug` path traversal (line 92, a one-line fix), the false-success return when `spawn` fails (lines 173-191 — the user is told "Lane dispatched (pid 0)" when no process exists), and the unconditional registration in `rpc-manager.ts:2056` of a tool whose prompt instructs the model to stop editing files inline, on machines that may not have GSD installed at all. Compounding this, the test file provides no protection against any of them — it asserts only that five schema keys exist and that a factory returns a truthy object, including one assertion (`assert.ok(ext)`, line 46) that is structurally incapable of failing. The gap between "5 tests pass" and "the dispatch path is verified" is the entire diff.

## Top 3 Priorities

1. **Sanitize the slug and verify the spawn** (~10 lines, eliminates two HIGHs): `uniqueSlug(slugify(params.slug || params.task))`, and gate the success return on `child.pid !== undefined` plus a one-tick `'spawn'`/`'error'` race.
2. **Gate the extension on GSD availability** (~5 lines in `createGsdLaneExtension` or `rpc-manager.ts:2056`): register no tool when `gsd_impl_lane.py` is absent, so non-GSD sessions keep their normal Edit/Write behavior instead of being steered into a tool that always fails.
3. **Test `execute()` against a stub GSD bin** (~60 lines): assert the written params JSON for `ScopeGlobs` array-ness, 40-char `Base`, traversal-safe `SpecFile`, and assert `isError: true` on build-queue failure. This is what converts every remaining fix in this review into a regression guard.

## Risk Assessment: **HIGH**

Justification: a model-controlled string reaches `writeFile` path construction with no sanitization (arbitrary file write with model-controlled content); a failure mode exists in which the user is affirmatively told work was dispatched when no process was created; and the extension is enabled for every session with a prompt directive that redirects all file edits into that path. The blast radius is every pi-web session on the machine, and the test suite as written would stay green through all three.

## Findings JSON

```json
[
  {
    "severity": "HIGH",
    "title": "Model-supplied `slug` reaches filesystem paths unsanitized (path traversal)",
    "file": "lib/gsd-lane-extension.ts",
    "line": 92,
    "category": "safety",
    "description": "`const baseSlug = params.slug || slugify(params.task)` sanitizes only the task-derived branch. An explicit `slug` param from the model bypasses `slugify()` and flows into join(worktreeRoot, `pi-${slug}`) (L97), `lane/${slug}` (L98), `spec-${slug}.md` (L113), `p-${slug}-params.json` (L141), `q-${slug}.json` (L144) and `log-${slug}.txt` (L158). A slug of `../../../.ssh/authorized_keys` escapes `.planning/impl-lanes/` and writeFile clobbers the target with fully model-controlled spec content. The random hex suffix does not prevent traversal. The parameter description ('Short kebab-case identifier') is documentation, not enforcement.",
    "recommendation": "Change line 92-93 to `const slug = uniqueSlug(slugify(params.slug || params.task));` so both input sources pass through the same sanitizer."
  },
  {
    "severity": "HIGH",
    "title": "Spawn failure returned to the user as a successful dispatch",
    "file": "lib/gsd-lane-extension.ts",
    "line": 183,
    "category": "robustness",
    "description": "spawn() is asynchronous; a missing `python` or missing gsd_impl_lane.py surfaces via the 'error' event after execute() has already returned. `const pid = child.pid || 0` (L173) masks the exact signal that detects this, and the return at L183-191 runs unconditionally. The user is told `Lane dispatched: <slug> (pid 0)` while no process exists; the real error is appended to a log file nothing reads, via a write that may itself fail with EBADF and is swallowed by `.catch(() => {})` (L176).",
    "recommendation": "After spawn, `if (child.pid === undefined) return { content: [...], isError: true }`, and await a one-tick race on `child.once('spawn')` vs `child.once('error')` before returning, propagating err.message as isError text."
  },
  {
    "severity": "HIGH",
    "title": "Extension registered unconditionally with a behavior-overriding prompt directive",
    "file": "lib/rpc-manager.ts",
    "line": 2056,
    "category": "architecture",
    "description": "`createGsdLaneExtension({ cwd: sessionCwd })` is added with no availability check or feature flag, while the adjacent subagent extension at L2054 is gated by `isBuiltInSubagentsEnabled`. gsdBinDir defaults to `$HOME/gsd-config/get-shit-done/bin` (gsd-lane-extension.ts:62-65). On any machine without GSD, every session gains a DispatchLane tool whose promptGuidelines[0] says 'never run Edit/Write inline when a lane can do it' (L78). The model obeys, build-queue fails on a nonexistent script, and the user receives a lane-queue error instead of the requested edit — a behavioral regression, not a no-op.",
    "recommendation": "Probe `existsSync(join(gsdBinDir, 'gsd_impl_lane.py'))` in createGsdLaneExtension and register no tool when absent, or gate the rpc-manager entry behind an `isGsdLanesEnabled`-style predicate matching the surrounding pattern."
  },
  {
    "severity": "HIGH",
    "title": "Empty catch blocks silently substitute wrong worktree root and drop model routing",
    "file": "lib/gsd-lane-extension.ts",
    "line": 44,
    "category": "robustness",
    "description": "`catch {}` at L44 discards the gsd-config error and returns join(tmpdir(), 'pi-lanes'); `catch { return null }` at L56-58 drops model routing, after which `if (resolved)` (L134) omits Provider/Model/Effort from lane params and L189 filters the empty `Model:` line out of the output. The user cannot distinguish 'routing intentionally defaulted' from 'gsd-config.py crashed'. This violates the explicit project rule: bare swallow on operations producing caller-visible values is forbidden; partial results must carry both the fallback and the error.",
    "recommendation": "Return `{ value, error? }` from both helpers and emit a `Warning: model routing unavailable (<msg>); lane will use lane-side defaults` line in the tool output when error is set."
  },
  {
    "severity": "HIGH",
    "title": "No durable PID/exit-code record for detached lane processes",
    "file": "lib/gsd-lane-extension.ts",
    "line": 178,
    "category": "robustness",
    "description": "The PID exists only in transient chat text (L185); `child.on('exit', () => { logFd.close() })` ignores the exit code and signal entirely, and nothing is persisted to disk. The machine contract requires managed Windows Python children to retain stdout, stderr, PID, exit code and whole-tree termination evidence — only stdout/stderr are captured. An orphaned detached lane cannot be located or swept, and no caller can ever determine whether the lane succeeded.",
    "recommendation": "Write `join(lanesDir, `pid-${slug}.json`)` with `{ pid, slug, startedAt, queuePath }` immediately after spawn, and update it with `{ exitCode, signal, endedAt }` inside the exit handler: `child.on('exit', (code, signal) => { ... })`."
  },
  {
    "severity": "HIGH",
    "title": "Tests cover only registration metadata; execute() is entirely untested",
    "file": "lib/gsd-lane-extension.test.mjs",
    "line": 17,
    "category": "testing",
    "description": "All five tests assert tool name, extension name/hidden, presence of five schema keys, and executionMode. No test invokes execute(), so slug sanitization, the git-failure branch, the build-queue failure return, the emitted lane-params shape, and the spawn arguments have zero coverage — every HIGH finding in this review sits in code no test touches. The suite stays green through all of them.",
    "recommendation": "Inject `python`/`gsdBinDir` pointing at a temp-dir stub script, call `tool.execute('id', {...})`, and assert on the written `p-<slug>-params.json`: ScopeGlobs is an array, Base is a 40-char SHA, a traversal slug resolves under lanesDir, and build-queue failure yields `isError: true`."
  },
  {
    "severity": "HIGH",
    "title": "Tautological test: `uses provided gsdBinDir` asserts only object truthiness",
    "file": "lib/gsd-lane-extension.test.mjs",
    "line": 46,
    "category": "testing",
    "description": "The test passes `gsdBinDir: '/custom/bin'` then asserts `assert.ok(ext, 'extension should accept custom gsdBinDir')`. createGsdLaneExtension always returns an object literal, so this assertion cannot fail whether gsdBinDir is honored or silently ignored. It reads as coverage of the injection point while verifying nothing — worse than omitting the test.",
    "recommendation": "Dispatch against `gsdBinDir: '/definitely/missing'` and assert the returned `isError` text contains that path, proving the value actually reaches the argv construction at L148."
  },
  {
    "severity": "MEDIUM",
    "title": "Silent fallback to floating `HEAD` as the lane base commit",
    "file": "lib/gsd-lane-extension.ts",
    "line": 105,
    "category": "correctness",
    "description": "If `git rev-parse HEAD` fails (git not on PATH, unborn branch, permission error), `head` becomes the literal string 'HEAD' and is sent as laneParams.Base. Given executionMode 'parallel' and detached background execution, the worktree is then created off whatever HEAD points at whenever the lane starts, which can be several commits past the dispatch point — a nondeterministic base in the authoritative path. The status line also degrades to `Base: HEAD` (L188 `head.slice(0, 8)`), which reads as a plausible short SHA.",
    "recommendation": "Treat rev-parse failure as fatal: return `{ content: [...], isError: true }` naming the repo path and the git error, rather than substituting a floating ref."
  },
  {
    "severity": "MEDIUM",
    "title": "UNVERIFIED-CONTRACT: `Task: Date.now()` is a synthetic ID that cannot join the task board",
    "file": "lib/gsd-lane-extension.ts",
    "line": 116,
    "category": "integration",
    "description": "gsd_impl_lane.py is not in the review material, so its `Task` contract is unconfirmed. Two risks hold regardless: two dispatches in the same millisecond emit identical Task IDs with differing slugs, and the stated integration goal ('task panel shows lane progress' via .planning/threads/board.jsonl, which uses small `#id` numbers per RESUME-PI-WEB-UI.md) cannot correlate against a 13-digit epoch value — the panel will show nothing for dispatched lanes.",
    "recommendation": "Read the gsd_impl_lane.py params schema; either allocate a real board ID via gsd_board.py, or omit `Task` if it is optional. Do not mint IDs client-side."
  },
  {
    "severity": "MEDIUM",
    "title": "UNVERIFIED-CONTRACT: `ScopeGlobs: []` may fail closed for every default dispatch",
    "file": "lib/gsd-lane-extension.ts",
    "line": 125,
    "category": "integration",
    "description": "`params.write_scope || []` sends an empty array when write_scope is omitted, which is the common case since the parameter is optional and no prompt guideline requires it. An empty glob list and an absent key are different signals: `[]` commonly means 'no path matches, no writes permitted' (fail-closed) while omission means unrestricted. If the producer fails closed, every default lane produces zero commits against `ExpectedCommits: 1` and reports a failed integration.",
    "recommendation": "Omit the key when undefined: `...(params.write_scope?.length ? { ScopeGlobs: params.write_scope } : {})`, after confirming the producer's interpretation of a missing key."
  },
  {
    "severity": "MEDIUM",
    "title": "Task text triple-encoded across Message, SpecFile and Title with no precedence",
    "file": "lib/gsd-lane-extension.ts",
    "line": 123,
    "category": "api",
    "description": "`Message: params.task` (L123) and `SpecFile: specPath` (L124, whose file content is `# title\\n\\n${params.task}` from L114) carry identical information, and `Title` derives from it a third time (L122). Whichever one the lane consumes, the others are unread duplicates that will diverge the moment either format changes — and no reader of this file can tell which is authoritative.",
    "recommendation": "Pick one channel. If the lane reads SpecFile, drop `Message` and the redundant write; if it reads Message, drop the spec-file write at L113-114 entirely (which also removes one accumulating artifact)."
  },
  {
    "severity": "MEDIUM",
    "title": "FileHandle.fd passed to stdio with racy double-close",
    "file": "lib/gsd-lane-extension.ts",
    "line": 175,
    "category": "safety",
    "description": "The 'error' handler writes then closes (L175-177) while the 'exit' handler closes independently (L178-180). Node does not guarantee 'exit' fires after a spawn 'error', and when both fire the write can land after the close, yielding EBADF swallowed by `.catch(() => {})` — so the sole diagnostic for a failed spawn is best-effort. Separately, holding the FileHandle open in the parent for the full lifetime of a multi-hour autonomous lane leaks a parent-side descriptor per dispatch.",
    "recommendation": "Close the handle immediately after spawn() returns (the child already holds its own duplicated descriptor) and route spawn errors through the session logger and the tool's isError return instead of the file handle."
  },
  {
    "severity": "MEDIUM",
    "title": "Unbounded dispatch-artifact accumulation inside the target repo",
    "file": "lib/gsd-lane-extension.ts",
    "line": 110,
    "category": "debt",
    "description": "Every dispatch writes four files under `<repo>/.planning/impl-lanes/`: spec-<slug>.md (L113), p-<slug>-params.json (L141), q-<slug>.json (L144), log-<slug>.txt (L158). Nothing deletes them on success, failure, or a retention schedule, and the random slug suffix guarantees re-dispatching the same task adds four more rather than overwriting. These are untracked files in the working tree of the repo the lane is about to commit to, so a permissively-scoped lane can commit its own dispatch metadata — including full task text — into the user's history.",
    "recommendation": "Write artifacts under `join(tmpdir(), 'pi-lanes', slug)` (consistent with the worktree-root fallback at L45), or add a retention sweep that prunes completed lanes' files."
  },
  {
    "severity": "MEDIUM",
    "title": "Three copies of the GSD-script invocation pattern with three different error policies",
    "file": "lib/gsd-lane-extension.ts",
    "line": 38,
    "category": "dry",
    "description": "resolveWorktreeRoot (L37-45), resolveModel (L49-58) and the build-queue call (L146-156) all build `execFileAsync(python, [join(gsdBinDir, '<script>.py'), ...args], { timeout })`. The first two are near-identical 8-line bodies differing only in script name, argv tail and parsing. Each carries an independently written timeout (10_000 / 10_000 / 30_000) and a different error policy (swallow-and-default / swallow-and-null / return isError), so the error contract is a hidden property of each copy rather than a caller decision.",
    "recommendation": "Extract `async function runGsd(script, args, opts): Promise<{ ok: true, stdout: string } | { ok: false, error: string }>`; each call site becomes one line plus an explicit decision on the result."
  }
]
```
