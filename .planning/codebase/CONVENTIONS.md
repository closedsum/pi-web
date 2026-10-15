# Coding Conventions

## TypeScript

- Strict mode enabled, `@/` path alias maps to project root
- Functional components with hooks (no class components)
- `"use client"` directive for client-side components
- Type imports: `import type { X }` for type-only imports
- Exported interfaces/types alongside their implementation modules

## React Patterns

- **Memo wrapping:** Performance-sensitive components wrapped in `memo()` (e.g., `ChatInput`, `MessageView`)
- **ForwardRef:** Components needing imperative handles use `forwardRef`
- **Custom hooks:** Extract reusable logic into `hooks/use<Name>.ts`
- **State management:** React state + `useState`/`useReducer`, no external state library
- **Layout persistence:** `localStorage` via `hooks/useLayoutPreferences.ts`

## Component Organization

- Large components (AppShell, ChatWindow, MessageView, SessionSidebar) are 1500-2700+ lines
- Helper functions and sub-components defined in the same file
- Styles in global CSS files (`globals.css`, `settings.css`), not CSS modules (except `ChatMinimap.module.css`)

## Extension System

- Block rules are pure functions: `(toolName, input) => BlockResult | undefined`
- Each rule is individually exported and testable
- All rules registered in `ALL_RULES` array
- `evaluateBlockRules()` runs all rules, returns first match

## Error Handling

- API routes return typed JSON responses via `lib/json-response.ts`
- Path security enforced at API boundary via `lib/path-security.ts`
- File operations use try/catch with graceful degradation
- Agent session errors surface as SSE events to the client

## Naming

- Files: kebab-case (`model-registry.ts`, `dispatch-status.ts`)
- Components: PascalCase (`ChatWindow.tsx`, `ModelSelector.tsx`)
- Functions: camelCase (`evaluateBlockRules`, `readAllDispatches`)
- Constants: UPPER_SNAKE_CASE (`ORCH_ALLOW`, `DEFAULT_BUDGETS`)
- Interfaces: PascalCase (`BlockRule`, `OrchestratorBudgets`)

## Imports

- Absolute imports via `@/` alias: `import { X } from "@/lib/module"`
- Node built-ins: `import { X } from "node:fs"`
- No barrel exports — import from specific files

## CSS

- Global CSS with BEM-like class names (`settings-chat-option`, `session-tree-title`)
- CSS custom properties on `:root` for theming (`--text`, `--bg`, `--border`)
- Dark mode via `prefers-color-scheme` media queries
- Tailwind utilities for layout (`flex`, `gap-*`, `text-*`)
