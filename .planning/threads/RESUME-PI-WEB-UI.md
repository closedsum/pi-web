# Resume: pi-web UI Customization

## Context

`closedsum/pi-web` fork at `D:\Trees\pi-web` on branch `feat/gsd-sidebar-panel`. The fork gives full control over the pi-web React/Next.js UI — any layout, panel, component, or style can be customized.

## What's Done (Session 3)

### Test Fixes
- **All 16 pre-existing test failures resolved** — 1146 tests, 1144 pass, 0 fail, 2 skipped
- CRLF normalization across 33 test files (`.replace(/\r\n/g, "\n")`)
- `worktree.ts`: git path handling for `--path-format=absolute` on older git
- `terminal-manager.ts`: conpty cleanup timer + PID 0 handling
- `project-command-env`: cross-platform PATH delimiter
- `package.json`: `--test-skip-pattern` for API route dirs named `test/`
- Cross-reviewed (4 reviewers, 0 surviving findings)

### UI Polish
- **Tighter tool call blocks** — padding 6px→3px, gap 7→5, border-radius 7→5, left-accent border
- **Green blob polish** — transparent background, subtle 1px border + 2px left accent
- **Settings reset button** — "Reset to defaults" in Layout section, CSS classes, clears all `pi-layout:*` localStorage

## What's Done (Session 2)

### Task Panel
- **Dedicated resizable TaskPanel** between sidebar and chat, reads `.planning/threads/board.jsonl` via `/api/task-board` API route
- Color-coded `[model effort tasktype]` tags — per-family model colors (amber=anthropic, green=openai, blue=qwen, pink=meta), cyan effort, orange tasktype — driven by `lib/model-display.json`, with orange brackets
- `#id` task numbers prepended, bold
- In Progress/Pending sorted by `created_at`
- Braille spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` on In Progress section header
- Elapsed time tag on in-progress tasks (green, updates every 60s)
- Session-scoped completed list (only shows tasks completed during this pi-web session)
- Synopsis counts in header: **X** done · **X** active · **X** pending (color-coded, bold numbers)
- 5s poll interval (configurable 2-30s in settings)
- Red BLOCKED badge on blocked pending tasks

### Chat & Input
- **Unified Send button** replaces Steer/Follow Up — queues messages for next turn
- Follow-up messages now appear as visible user chat bubbles (optimistic entry push)
- Process details collapsed by default (configurable in settings)
- **Elapsed timer + braille spinner** on running tool calls in chat

### Sidebar
- Collapsible "Sessions" header with chevron toggle (persisted to localStorage)
- `/new` and `/clear` delete all non-running sessions for current project
- **Recent projects dropdown** — folder icon button left of "+ New", reads `~/.pi/recent-projects.json`, auto-tracks on project selection

### Context Bar
- Claude CLI-style block character bar `████████░░░░` with text
- Color transitions: green → yellow (>70%) → red (>90%)
- Starting color configurable in settings

### Settings (General → Layout)
10 controls, all wired to actual behavior:
- Task panel on/off, Clear sessions on /new, Collapse process details, Session-only completed (toggles)
- Task poll interval (slider 2-30s), Task font size (slider 10-16px)
- Context bar color, Model tag color, Effort tag color, Task type tag color (dropdowns)

## What's Queued

### #7: Non-blocking agent via GSD orchestration layer
Pi agent should dispatch all work through `gsd_impl_lane.py` instead of blocking on inline tool calls. Agent receives user intent, dispatches as a lane, responds immediately. Task panel shows lane progress. Chat stays responsive. Requires: agent config/system prompt for lane dispatch, API bridge between pi RPC and `gsd_impl_lane.py`, task panel integration with lane status.

### UI Polish
- ~~Auto-collapse command/script blobs~~ — DONE (tighter padding, left-accent border)
- ~~Green dispatch result blob~~ — DONE (transparent bg, subtle border)
- ~~Settings reset button~~ — DONE (CSS classes, wired to resetAll)

## Architecture Notes

- **No state management library** — all `useState`/`useRef` in components, props thread through AppShell
- **Settings persistence** — `useLayoutPreferences` hook reads/writes `pi-layout:*` keys in localStorage
- **Panel system** — each panel is a self-contained directory (`components/task-panel/`) with its own component, test, types, and API route. Layout constants in `lib/panel-layout.ts`, CSS in `app/globals.css`, resize via `useResizablePanel` hook.
- **Task data** — `/api/task-board?cwd=<path>` reads `.planning/threads/board.jsonl`, returns `{ tasks, counts, lastModified }`
- **Recent projects** — `/api/recent-projects` GET/POST, persists to `~/.pi/recent-projects.json`

## Test Baseline

1146 tests, 1144 pass, 0 fail, 2 skipped. All pre-existing failures resolved in session 3.

## Dev Setup

```
cd D:\Trees\pi-web
npm run dev          # starts dev server on 127.0.0.1:30141
npm test             # runs unit tests (1146 tests)
pi.bat               # launches with auto-close watchdog
```

## Remotes

- `origin` = agegr/pi-web (upstream)
- `fork` = closedsum/pi-web (our fork)
