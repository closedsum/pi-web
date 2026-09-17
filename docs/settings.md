# Settings System

Layout preferences persisted to `localStorage` with the `pi-layout:` prefix.

## Architecture

```
useLayoutPreferences.ts          SettingsPanel.tsx          Components
┌─────────────────────┐         ┌──────────────┐          ┌──────────┐
│ LAYOUT_DEFAULTS      │ ◄────── │ Layout section│ ──write──│ read via │
│ readPref(key)        │         │ dropdowns,    │          │ readPref │
│ writePref(key,val)   │         │ sliders,      │          │ or hook  │
│ resetAll()           │         │ toggles       │          │          │
│ parseCollapsePatterns│         └──────────────┘          └──────────┘
│ shouldCollapseContent│
└─────────────────────┘
```

## Current Preferences

| Key | Type | Default | Controls |
|-----|------|---------|----------|
| `taskPanelEnabled` | boolean | `true` | Show/hide task panel |
| `taskPollInterval` | number | `5` | Task board poll interval (seconds, 2-30) |
| `completedScope` | string | `"session"` | Show only session-completed tasks |
| `clearSessionsOnNew` | boolean | `true` | Clear sessions on /new |
| `contextBarColor` | string | `"rgba(0,255,0,0.95)"` | Context bar starting color |
| `processDetailsCollapsed` | boolean | `true` | Collapse process details by default |
| `taskFontSize` | number | `12` | Task panel font size (px, 10-16) |
| `tagColorModel` | string | `"#a78bfa"` | Model tag fallback color (task panel uses per-family colors from `lib/model-display.json`) |
| `tagColorEffort` | string | `"#22d3ee"` | Effort tag color (cyan) |
| `tagColorTasktype` | string | `"#fb923c"` | Task type tag color (orange) |
| `collapsePatterns` | string | `"gsd-ue-dispatch,..."` | Auto-collapse pattern list |
| `processHeaderColor` | string | `"var(--text-muted)"` | Process details header color |
| `processHeaderStyle` | string | `"normal"` | Process header font (normal/mono) |

## Adding a New Preference

### 1. Add to LAYOUT_DEFAULTS

```typescript
// hooks/useLayoutPreferences.ts
export const LAYOUT_DEFAULTS = {
  // ... existing ...
  myNewPref: "default-value" as string,
};
```

### 2. Add settings control

```tsx
// components/SettingsPanel.tsx — inside the Layout section
<div className="settings-chat-option settings-chat-switch-option">
  <span>My Setting Label</span>
  <select className="settings-layout-select"
    value={layoutPrefs.myNewPref}
    onChange={(e) => setLayoutPref("myNewPref", e.target.value)}>
    <option value="a">Option A</option>
    <option value="b">Option B</option>
  </select>
</div>
```

### 3. Read in components

```typescript
// Direct read (no re-render on change):
import { readPref } from "@/hooks/useLayoutPreferences";
const value = readPref("myNewPref");

// Via hook (re-renders on change):
const { prefs } = useLayoutPreferences();
const value = prefs.myNewPref;
```

## Serialization

All values stored as strings in localStorage. The `readPref` function handles type coercion:
- Booleans: `"true"` / `"false"`
- Numbers: `String(n)` → `Number(stored)`
- Strings: stored directly

Arrays are stored as comma-separated strings and parsed with `parseCollapsePatterns()`.

## Reset

`resetAll()` removes all `pi-layout:*` keys from localStorage and resets state to `LAYOUT_DEFAULTS`. Wired to "Reset to defaults" button in the Layout section.
