# Directory Structure

## Top-Level Layout

```
pi-web/
├── app/                    # Next.js App Router pages and API routes
│   ├── api/                # ~25 API route groups
│   ├── login/              # Password login page
│   ├── page.tsx            # Main SPA page
│   ├── layout.tsx          # Root layout
│   ├── globals.css         # Global styles (2000+ lines)
│   ├── settings.css        # Settings panel styles
│   └── sidebar.css         # Sidebar styles
├── bin/                    # CLI entry points
│   ├── pi-web.js           # Main CLI — starts server, opens browser
│   ├── pi-web-options.js   # CLI argument parsing
│   └── ...                 # Helper modules
├── components/             # React components (~60 files)
│   ├── AppShell.tsx        # Top-level shell (2700+ lines)
│   ├── ChatWindow.tsx      # Chat view (1800+ lines)
│   ├── ChatInput.tsx       # Message composer
│   ├── MessageView.tsx     # Message renderer (2300+ lines)
│   ├── SessionSidebar.tsx  # Session/file sidebar (2400+ lines)
│   ├── ModelSelector.tsx   # Model dropdown
│   ├── SettingsPanel.tsx   # Settings UI
│   ├── task-panel/         # Task panel components
│   │   ├── TaskPanel.tsx
│   │   └── DispatchSection.tsx
│   └── sidebar-extensions/ # Sidebar extension widgets
├── hooks/                  # React hooks (~15 files)
│   ├── useAgentSession.ts  # Agent session management
│   ├── useLayoutPreferences.ts
│   └── ...
├── lib/                    # Core library (~180 files)
│   ├── rpc-manager.ts      # RPC session manager (central)
│   ├── gsd-lane-extension.ts # Orchestrator mode
│   ├── extensions/         # Extension framework
│   │   ├── tool-blockers.ts # 21 block rules
│   │   ├── types.ts
│   │   ├── _test-harness.mjs
│   │   └── pi_launcher.py
│   ├── model-display.json  # Model family config (colors, names)
│   ├── model-registry.ts   # Model display name resolution
│   ├── dispatch-status.ts  # Lane manifest reader
│   ├── task-board.ts       # Task board JSONL reader
│   └── ...                 # 170+ other modules
├── test/                   # Test infrastructure
│   ├── extensions/         # 70+ extension test directories
│   ├── e2e/                # E2E Python test helpers
│   └── test-model.json     # Test model config
├── e2e/                    # Playwright E2E tests
│   ├── run.mjs             # Main E2E runner
│   └── *.mjs               # Individual test modules
├── public/                 # Static assets
│   ├── sw.js               # Service worker
│   └── *.svg               # Icons
├── .planning/              # GSD planning (not committed)
└── instrumentation-node.ts # OpenTelemetry instrumentation
```

## Naming Conventions

- **Components:** PascalCase `.tsx` files, co-located `.test.mjs` tests
- **Lib modules:** kebab-case `.ts` files, co-located `.test.mjs` tests
- **Extension tests:** `test/extensions/<hook-name>/<hook-name>.test.mjs`
- **API routes:** `app/api/<resource>/route.ts`, tests in `app/api/<resource>/test/` or co-located
- **Hooks:** `hooks/use<Name>.ts`

## Key File Locations

| Need | File |
|------|------|
| Add a model family | `lib/model-display.json` |
| Add a block rule | `lib/extensions/tool-blockers.ts` |
| Modify orchestrator mode | `lib/gsd-lane-extension.ts` |
| Change session startup | `lib/rpc-manager.ts` |
| Add an API route | `app/api/<name>/route.ts` |
| Add a component | `components/<Name>.tsx` |
| Add an extension test | `test/extensions/<name>/<name>.test.mjs` |
| Configure test model | `test/test-model.json` |
