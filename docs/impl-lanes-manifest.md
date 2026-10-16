# Impl-Lanes Pipeline Manifest Format

Lane pipeline manifests live in `.planning/impl-lanes/` as JSON files. Two files per lane:

## `p-{slug}.json` — Pipeline manifest (status)

Written and updated by `gsd_impl_lane.py` during lane execution. Read by `lib/dispatch-status.ts` for the Task Panel.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"pipeline"` | Always `"pipeline"` |
| `slug` | string | Lane identifier (matches params file) |
| `Task` | number | Numeric task ID |
| `ExpectedCommits` | number | Expected number of commits |
| `ScopeGlobs` | string[] | Glob patterns the lane may read |
| `WriteScope` | string[] | Glob patterns the lane may write |
| `repo` | string | Absolute path to project root |
| `worktree` | string | Absolute path to lane worktree |
| `branch` | string | Git branch name (`lane/{slug}`) |
| `title` | string | Human-readable description |
| `base` | string | Base commit SHA |
| `phase` | string | Current pipeline phase (see below) |
| `status` | string | `"running"` / `"failed"` / `"complete"` / `"blocked"` |
| `rounds` | array | Review round history |
| `summary` | string | Completion summary text |
| `start` | string | ISO 8601 start timestamp |
| `end` | string | ISO 8601 end timestamp |
| `updated_at` | string | ISO 8601 last-update timestamp |
| `pid` | number | OS process ID |
| `exit_code` | number | Process exit code (0 = success) |
| `_error` | string | Error message if failed |
| `preflight` | object | Preflight check results |
| `review_dir` | string | Path to review artifacts |
| `ledger` | string | Path to cross-review ledger |

### Pipeline phases

`init/preflight` → `init/worktree` → `impl` → `review` → `fix` → `terminal`

Special: `blocked_policy` when a policy gate blocks the lane.

## `p-{slug}-params.json` — Dispatch parameters

Written at dispatch time. Read-only after creation.

| Field | Type | Description |
|-------|------|-------------|
| `Slug` | string | Lane identifier |
| `Task` | number | Numeric task ID |
| `Repo` | string | Project root path |
| `Title` | string | Human-readable task description |
| `Message` | string | Full task prompt for the executor |
| `SpecFile` | string | Path to the lane spec `.md` file |
| `ScopeGlobs` | string[] | Read-scope globs |
| `Worktree` | string | Worktree path |
| `Branch` | string | Git branch name |
| `Base` | string | Base commit SHA |
| `Provider` | string | Model provider (when resolved) |
| `Model` | string | Model ID (when resolved) |
| `Effort` | string | Effort level (when resolved) |
| `ModelReason` | string | Why this model was chosen |
| `SkipImpl` | boolean | Skip implementation (review-only) |
| `SkipReview` | boolean | Skip cross-review |
| `ExpectedCommits` | number | Expected number of commits |
