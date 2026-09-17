<!-- QwenCLI: model=qwen3.8-max model_requested=qwen3.8-max model_resolved=qwen3.8-max elapsed=492.5s -->

# Cross-AI Code Review — GSD Lane Dispatch Extension v2

Review of the staged diff: `lib/gsd-lane-extension.ts` (new, 204 lines), `lib/gsd-lane-extension.test.mjs` (new, 49 lines), `lib/rpc-manager.ts` (+2 lines), `.planning/threads/RESUME-PI-WEB-UI.md` (planning doc — no findings, treated as metadata).

---

## 1. Correctness
**Score:** 3

**Strengths:**
- `slugify` (`lib/gsd-lane-extension.ts:23-29`) sanitizes to `[a-z0-9-]` and trims, so the slug is safe for filenames and branch names; `uniqueSlug` (`:31-34`) appends 6 hex chars, eliminating cross-dispatch file collisions.
- `build-queue` failure path (`:153-156`) correctly returns `isError: true` with the subprocess message.

**Concerns:**
- **MEDIUM** — `resolveModel` (`:48-59`) returns raw `JSON.parse` output with no shape validation; missing keys propagate as `undefined` into `laneParams` (`:134-139`) and render as `Model: undefined (undefined)` at `:191`. See finding below.
- **MEDIUM** — `Task: Date.now()` (`:116`, `:120`) can produce duplicate IDs for lanes dispatched in the same millisecond; the tool runs with `executionMode: "parallel"` (`:83`), which is precisely the multi-dispatch case.

**Recommendations:** Validate the `resolve-model` JSON shape before use; derive Task IDs with a uniqueness guarantee (see Findings JSON).

## 2. Architecture
**Score:** 4

**Strengths:**
- Clean single-module extension with injectable `cwd` / `gsdBinDir` / `python` options (`:17-21`, `:61-66`) — testable seams without touching real processes.
- Pure helpers (`slugify`, `uniqueSlug`, resolvers) are separated from the tool definition; `rpc-manager.ts:35` import + `:2056` registration is minimal and matches the neighboring `createSubagentExtension` pattern.

**Concerns:** None material. The two resolvers thread `(python, gsdBinDir)` explicitly, which is fine at this size.

**Recommendations:** None.

## 3. Integration
**Score:** 3

**Strengths:**
- The lane params record (`:118-139`) passes the previously-flagged fields explicitly (`SpecFile`, `ScopeGlobs` as array, `Task`), consistent with the stated v2 fix list.

**Concerns:**
- **MEDIUM (UNVERIFIED)** — The two module specifiers at `:1` and `:5` render as `" @earendil-works/pi-ai"` / `" @earendil-works/pi-coding-agent"` with a leading space inside the quotes. Every other column-0 line in this packet renders without an inserted space (e.g. `:6-11`, `rpc-manager.ts:34`), so this may be real source text rather than a rendering artifact. If real, both imports fail to resolve and the module fails to load, which breaks the extension array in `startRpcSession` (`rpc-manager.ts:2056`) and the jiti import in the test (`gsd-lane-extension.test.mjs:5`).
- **MEDIUM (UNVERIFIED-CONTRACT)** — `Task: Date.now()` numeric type and collision behavior against `gsd_impl_lane.py`'s expectations cannot be verified from this material (consumer source not in the packet).

**Recommendations:** Confirm the import specifiers byte-for-byte; confirm `Task` type/uniqueness expectations with the lane runner contract.

## 4. Safety
**Score:** 4

**Strengths:**
- `execFileAsync`/`spawn` with argument arrays — no shell interpolation anywhere; slug is sanitized before entering any path (`:97`, `:113`, `:141`, `:144`, `:158`), so no path traversal via user-supplied task text.
- `windowsHide: true` + `detached: true` + `child.unref()` (`:167-171`, `:181`) is the correct background-process recipe on Windows.
- The double-close hazard between the `error` handler (`:175-177`) and `exit` handler (`:178-180`) is neutralized by `.catch(() => {})` on both `close()` calls.

**Concerns:** One open `FileHandle` is held per running lane until `exit` — bounded by concurrent lanes, acceptable.

**Recommendations:** None.

## 5. Performance
**Score:** 4

**Strengths:** Dispatch is not a hot path; two bounded subprocess probes (10 s timeouts, `:41`, `:53`) plus one 30 s `build-queue` (`:152`) give a worst-case ~50 s dispatch latency with no unbounded work.

**Concerns:** None measurable.

**Recommendations:** If dispatch latency becomes noticeable, `resolveWorktreeRoot`/`resolveModel` results are cacheable per extension instance — optional, not needed now.

## 6. Test Quality
**Score:** 3

**Strengths:**
- Tests run the real factory and assert on the registered tool surface (`gsd-lane-extension.test.mjs:7-15`), including `executionMode` and parameter schema keys (`:28-44`).

**Concerns:**
- **MEDIUM** — All five tests are structural; none exercise behavior. The last test (`:46-49`) asserts `assert.ok(ext)` on an object literal — it cannot fail and verifies nothing about `gsdBinDir`. No test covers the `execute` error path, `uniqueSlug`, or empty/Unicode task input.

**Recommendations:** Export `slugify`/`uniqueSlug` for direct unit tests; add an `execute` test pointing `gsdBinDir` at an empty temp dir so `build-queue` fails, asserting `isError: true` — this requires no real lane spawn.

## 7. Technical Debt
**Score:** 4

**Strengths:** No dead code, no TODOs, no leftover v1 scaffolding in the module.

**Concerns:**
- **LOW** — Every dispatch permanently writes four artifacts (`spec-*.md`, `p-*-params.json`, `q-*.json`, `log-*.txt`) into `.planning/impl-lanes` (`:110-114`, `:141-159`) with no cleanup path.

**Recommendations:** Delete `q-*`/`p-*` files after the queue is consumed, or document the retention policy (the lane runner may already own cleanup — not verifiable here).

## 8. API Design
**Score:** 4

**Strengths:** Tool parameters carry specific descriptions and usage guidelines (`:77-89`); the success payload is a structured, grep-friendly text block (`:186-196`) including worktree, branch, base SHA, and log path.

**Concerns:** None significant; `params.task.split(/[.\n]/)[0]` (`:122`) can yield an empty title if the task starts with punctuation — cosmetic.

**Recommendations:** None.

## 9. DRY / Duplication
**Score:** 4

**Strengths:** No copy-pasted blocks; `resolveWorktreeRoot` and `resolveModel` share a shape but differ enough in parsing/fallback semantics that merging them would be premature.

**Concerns:** None.

**Recommendations:** None.

## 10. Consistency
**Score:** 4

**Strengths:** Follows the neighboring extension registration pattern in `rpc-manager.ts:2050-2057`.

**Concerns:** Error-handling policy is mixed for equally critical failures: `build-queue` failure → `isError: true` (`:155`), but spawn failure → success message (see Finding 1), and config/model resolution failure → silent fallback (`:44`, `:56`). The first of these is the one that matters.

**Recommendations:** Align spawn-start failure with the `build-queue` error contract.

## 11. Simplification
**Score:** 4

**Strengths:** Straight-line dispatch flow with no wrapper layers or premature abstractions; the code reads top-to-bottom in execution order.

**Concerns:** None.

**Recommendations:** None.

## 12. Consolidation
**Score:** 4

**Strengths:** Single implementation of lane dispatch; no parallel subsystem introduced by this diff.

**Concerns:** None visible in the material.

**Recommendations:** None.

## 13. Robustness
**Score:** 3

**Strengths:**
- Spawn `error` handler writes a diagnostic to the lane log (`:175-177`) — the v2 fix is present and the fd is closed on that path.
- `git rev-parse` fallback to `"HEAD"` (`:104-106`) keeps dispatch alive on shallow/broken git states; `head.slice(0, 8)` at `:190` degrades gracefully for the literal `"HEAD"`.

**Concerns:**
- **HIGH** — A failed spawn is reported to the caller as a successful dispatch (`:173`, `:183-199`). See Finding 1.
- **LOW** — `resolveWorktreeRoot`'s empty `catch {}` (`:44`) silently redirects every lane to `%TEMP%/pi-lanes` when `gsd-config.py` fails (including a bad `python` binary), with the only signal being the `Worktree:` line in the response.

**Recommendations:** Treat `child.pid === undefined` as a dispatch failure; surface a fallback warning when the configured worktree root is unreachable.

## 14. Scalability
**Score:** 4

**Strengths:** Dispatch is O(1) per lane; uniqueness via random suffix rather than directory scans means no O(n) probing as lane count grows.

**Concerns:** Artifact accumulation (Finding 7) is the only scale-adjacent item.

**Recommendations:** None.

---

## Overall Assessment

The v2 revision lands the eight stated fixes correctly: sanitized unique slugs, spec file, explicit `SpecFile`/`ScopeGlobs`/`Task` params, stdio-to-log-file, spawn error handler, and PID capture are all present and mostly well done. The module is clean, the security posture is solid (no shell, sanitized paths, hidden window, detached+unref), and the integration into `rpc-manager.ts` follows the established extension pattern.

The one substantive gap is that the PID-capture fix papers over spawn failure instead of surfacing it: when the `python` binary is missing, the tool returns "Lane dispatched … running autonomously" with `pid 0` and no `isError`, so the agent waits on work that never started — a silent, indefinite stall. Secondary issues are unvalidated `resolve-model` JSON, millisecond-collision `Date.now()` task IDs under parallel dispatch, structure-only tests (including one assertion that cannot fail), and two items that could not be fully verified from the packet (leading space in the `@earendil-works` import specifiers, and the `Task` field contract with `gsd_impl_lane.py`).

## Top 3 Priorities
1. **Fail loudly on spawn failure** (`gsd-lane-extension.ts:173-199`): if `child.pid === undefined`, close the fd and return `isError: true` instead of the success block. Small change, removes the only silent-stall path.
2. **Validate `resolve-model` output and harden Task ID uniqueness** (`:48-59`, `:116`): shape-check `provider`/`model`/`effort`, and make Task IDs collision-proof for same-millisecond parallel dispatches (confirm expected type with the lane runner).
3. **Verify the two import specifiers** (`:1`, `:5`): confirm there is no leading space in `"@earendil-works/..."`; if present, this is a load-time crash of the whole extension. Then upgrade the no-op `gsdBinDir` test into a real `execute` error-path test.

## Risk Assessment
**MEDIUM.** No data loss, crash, or security exposure; the worst case is a lane that silently never runs (environment-triggered) plus minor correctness gaps under parallel dispatch. All top items are low-effort fixes.

## Findings JSON

```json
[
  {
    "severity": "HIGH",
    "title": "Spawn failure is reported as a successful dispatch",
    "file": "lib/gsd-lane-extension.ts",
    "line": 173,
    "category": "robustness",
    "description": "When spawn fails (e.g. `python` not on PATH), `child.pid` is undefined and the async `error` event fires after the tool has already returned. The code defaults `pid` to 0 and returns the success block (lines 183-199) without `isError`, telling the caller 'Lane dispatched ... running autonomously. Progress is visible in the task panel.' The lane never runs and the agent/user waits indefinitely; the only trace is a 'spawn error' line written to the log after the success response. This contradicts the tool's own contract, demonstrated one line above: `build-queue` failure returns `isError: true` (line 155).",
    "recommendation": "After spawn, check `if (child.pid === undefined) { await logFd.close(); return { content: [{ type: 'text', text: `Lane spawn failed for ${slug}: ${python} could not be started` }], details: undefined, isError: true }; }`. Node leaves `pid` undefined synchronously when the process fails to start, so this reliably catches ENOENT/EACCES before returning."
  },
  {
    "severity": "MEDIUM",
    "title": "resolveModel returns unvalidated JSON; missing keys flow into lane params and output",
    "file": "lib/gsd-lane-extension.ts",
    "line": 54,
    "category": "correctness",
    "description": "resolveModel (lines 48-59) returns raw JSON.parse output typed as {provider, model, effort} without validating the shape. Concrete scenario: `gsd_impl_lane.py resolve-model` prints valid JSON missing keys (e.g. `{\"model\":\"gpt-5\"}` or an error object). The `if (resolved)` guard at line 134 passes, `Provider`/`Model`/`Effort` are set to `undefined` and silently dropped by JSON.stringify (line 142), so the lane runs on consumer-side default routing instead of the resolved one, and the dispatch message at line 191 prints 'Model: undefined (undefined)'. This is a system boundary (subprocess stdout) with no validation.",
    "recommendation": "Validate before returning: `if (parsed && typeof parsed.provider === 'string' && typeof parsed.model === 'string' && typeof parsed.effort === 'string') return parsed;` otherwise return null so the existing fallback path applies."
  },
  {
    "severity": "MEDIUM",
    "title": "Module specifiers render with a leading space — verify before merge",
    "file": "lib/gsd-lane-extension.ts",
    "line": 1,
    "category": "integration",
    "description": "UNVERIFIED from rendered packet: both imports show `from \" @earendil-works/pi-ai\"` (line 1) and `from \" @earendil-works/pi-coding-agent\"` (line 5) with a space after the opening quote. Other column-0 lines in the same packet render without inserted spaces, so this may be real source text rather than a rendering artifact. If real, both imports fail module resolution at load time: the extension module cannot be imported, which breaks the extension array passed to startRpcSession (lib/rpc-manager.ts:2056) and fails the jiti import in lib/gsd-lane-extension.test.mjs:5 — i.e., the entire feature and its tests are dead on arrival.",
    "recommendation": "Open the actual file and confirm the specifiers are exactly \"@earendil-works/pi-ai\" and \"@earendil-works/pi-coding-agent\" with no leading whitespace; fix if present and re-run the test file, which would catch this immediately."
  },
  {
    "severity": "MEDIUM",
    "title": "Task ID = Date.now() collides for lanes dispatched in the same millisecond",
    "file": "lib/gsd-lane-extension.ts",
    "line": 116,
    "category": "integration",
    "description": "UNVERIFIED-CONTRACT (gsd_impl_lane.py not in review material): `const taskId = Date.now()` (line 116) is used as `Task: taskId` (line 120). The tool is registered with executionMode: 'parallel' (line 83) and its prompt guidelines encourage dispatching multiple lanes; two dispatches inside the same millisecond produce identical Task IDs. If the consumer uses Task for board entries/dedup/identification (the task panel displays '#id' numbers per .planning/threads/RESUME-PI-WEB-UI.md), duplicate IDs collide or one lane overwrites the other. The numeric type may also not match the consumer's expected schema.",
    "recommendation": "Make the ID unique per dispatch, e.g. reuse the already-unique slug as the task identifier, or `const taskId = `${Date.now()}-${randomBytes(2).toString('hex')}`` — after confirming the type gsd_impl_lane.py expects for `Task`."
  },
  {
    "severity": "MEDIUM",
    "title": "Tests are structure-only; gsdBinDir test asserts a tautology",
    "file": "lib/gsd-lane-extension.test.mjs",
    "line": 46,
    "category": "testing",
    "description": "All five tests verify registration/shape only (lines 17-44), none execute behavior. The 'extension uses provided gsdBinDir' test (lines 46-49) does `assert.ok(ext)` on the object returned by createGsdLaneExtension — an object literal that is always truthy, so the test cannot fail and verifies nothing about gsdBinDir. There is no coverage of execute()'s error path, uniqueSlug collisions, or slugify with empty/Unicode tasks (which yield the `lane-<hex>` fallback at gsd-lane-extension.ts:33).",
    "recommendation": "Export slugify/uniqueSlug and unit-test them (empty string, all-punctuation, Unicode input). Add an execute test: createGsdLaneExtension({ cwd: <tmp>, gsdBinDir: <empty tmp dir> }) so build-queue fails, then assert the result has isError: true and mentions the slug — no real lane spawn needed."
  },
  {
    "severity": "LOW",
    "title": "Silent fallback to tmpdir when worktree root config resolution fails",
    "file": "lib/gsd-lane-extension.ts",
    "line": 44,
    "category": "robustness",
    "description": "resolveWorktreeRoot swallows all failures in an empty `catch {}` (line 44) and falls back to join(tmpdir(), 'pi-lanes') (line 45). If gsd-config.py is broken, misconfigured, or the python binary is wrong, every lane silently lands in the OS temp directory instead of the configured root; the only diagnostic is the Worktree line in the dispatch output (line 188), which requires the operator to know what the value should have been.",
    "recommendation": "Capture the error and append a warning to the dispatch result text, e.g. `Note: worktree root fell back to ${fallback} (${err.message})`, so misconfiguration is visible at dispatch time."
  },
  {
    "severity": "LOW",
    "title": "Per-lane artifacts accumulate in .planning/impl-lanes without cleanup",
    "file": "lib/gsd-lane-extension.ts",
    "line": 110,
    "category": "debt",
    "description": "Every dispatch writes four files into <repo>/.planning/impl-lanes (spec-*.md line 113-114, p-*-params.json line 141-142, q-*.json consumed by build-queue line 144-152, log-*.txt line 158) and nothing in this diff ever removes them. Over weeks of lane usage the directory grows unboundedly inside the working tree; whether .planning/impl-lanes is gitignored is not visible in this material, so accumulated files may also pollute `git status` or be committed accidentally.",
    "recommendation": "Either delete q-*/p-* artifacts once the queue is built (they are inputs to build-queue only), or confirm/document that gsd_impl_lane.py owns cleanup and that the directory is gitignored."
  }
]
```
