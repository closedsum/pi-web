# UI Framework Guide

How to add and modify UI features in the pi-web fork.

## Component Architecture

No state management library. All state is `useState`/`useRef` in components, props thread through `AppShell`.

```
AppShell.tsx
├── SessionSidebar.tsx      (left: sessions, recent projects)
├── TaskPanel.tsx            (middle: GSD task board)
├── ChatWindow.tsx           (main: message list + process groups)
│   ├── MessageView.tsx      (individual message rendering)
│   │   ├── UserMessageView  (user bubbles, auto-collapse)
│   │   ├── AssistantMessageView (assistant responses)
│   │   ├── ToolCallBlock    (tool calls with status colors)
│   │   └── CustomMessageView (extension messages)
│   └── ProcessDetailsGroup  (collapsible process header)
├── ChatInput.tsx            (bottom: input, model/effort selectors)
└── SettingsPanel.tsx        (modal: General + Layout settings)
```

## Adding a New Component

1. Create `components/<Name>.tsx` with the component
2. Wire into the parent (usually `AppShell.tsx` or `ChatWindow.tsx`)
3. Add test at `components/<Name>.test.mjs`
4. If it has a settings knob, add to `useLayoutPreferences` + `SettingsPanel`

## Panel System

Each panel is self-contained. Example: `components/task-panel/TaskPanel.tsx`.

- Layout constants in `lib/panel-layout.ts`
- Resize via `useResizablePanel` hook
- Global CSS in `app/globals.css`

To add a new panel: create a directory, add the component + test + types + API route (if needed), wire into `AppShell.tsx` layout.

## Tool Call Rendering

`ToolCallBlock` in `MessageView.tsx` renders individual tool calls with:

- **Three-state colors:** Blue (in-progress), Green (success), Red (error)
- **Gradient shimmer** on active tool names (CSS class `tool-name-active`)
- **Result summary** in header via `getResultSummary()` — parses JSON for `planned_args`
- **Collapse/expand** toggle for input args and paired result
- Matching backgrounds: `rgba(R,G,B, 0.05-0.06)` tint

### Adding result preview for a new tool

Edit `getResultSummary()` in `MessageView.tsx`:
```typescript
function getResultSummary(result: ToolResultMessage | undefined): string {
  // ... existing JSON parsing ...
  // Add your pattern:
  if (json.your_field) return `→ ${json.your_field}`;
}
```

## Process Details Header

`ProcessDetailsGroup` in `ChatWindow.tsx` groups consecutive non-answer messages.

Header shows: message count, tool call count, tool names (highlighted tools bold + status-colored), usage tokens, cost, elapsed time.

### Highlighted tools

The `HIGHLIGHT_TOOLS` set in `ProcessDetailsGroup` controls which tool names get bold + status-colored treatment. Add new tools:
```typescript
const HIGHLIGHT_TOOLS = new Set(["ue_dispatch", "DispatchLane", "YourTool"]);
```

## Auto-Collapse Patterns

Messages matching configurable patterns collapse by default. Applied to:
- `UserMessageView` — user message content
- `CustomMessageView` — extension messages

Patterns stored as comma-separated string in `collapsePatterns` layout pref. Parsed by `parseCollapsePatterns()`, matched by `shouldCollapseContent()` (both in `useLayoutPreferences.ts`).

### Adding a new default pattern

Edit `LAYOUT_DEFAULTS.collapsePatterns` in `hooks/useLayoutPreferences.ts`.

## CSS Conventions

- CSS variables defined in `app/globals.css` (`:root` and `[data-theme]`)
- Component-specific styles in `app/settings.css` (settings), `app/globals.css` (everything else)
- Animations: `@keyframes` in `globals.css`, classes applied conditionally
- Theme-aware: always use `var(--bg)`, `var(--text)`, etc.

### Key CSS variables

```
--bg, --bg-panel, --bg-hover, --bg-selected, --bg-subtle, --border
--text, --text-muted, --text-dim
--accent, --user-bg, --tool-bg
--font-mono
--chat-font-size-offset
```
