# Technology Stack

## Languages & Runtime

- **TypeScript** — primary language for all application code
- **JavaScript (ESM)** — test files (`.test.mjs`), CLI entry points, extension fixtures
- **CSS** — global styles (`app/globals.css`, `app/settings.css`, `app/sidebar.css`)
- **Node.js >=22.19.0** — runtime requirement (uses `--experimental-strip-types`)
- **Python** — e2e test helpers (`test/e2e/`), launcher script (`lib/extensions/pi_launcher.py`)

## Framework

- **Next.js 16.3.6** (App Router) — server-side rendering, API routes, Turbopack dev
- **React 19.2.4** — UI components with hooks-based architecture
- **Tailwind CSS 4.2.2** — utility-first styling via `@tailwindcss/postcss`

## Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@earendil-works/pi-agent-core` | 1.2.0 | Core agent session management |
| `@earendil-works/pi-ai` | 1.2.0 | AI provider abstraction |
| `@earendil-works/pi-coding-agent` | 1.2.0 | Coding agent logic, extensions |
| `@earendil-works/pi-tui` | 1.2.0 | Terminal UI primitives |
| `@earendil-works/pi-mcp` | 1.2.0 | MCP protocol support |
| `@earendil-works/pi-codemode` | 1.2.0 | Code mode execution |
| `@earendil-works/pi-telemetry` | 1.2.0 | Usage telemetry |
| `@xterm/xterm` | 6.0.0 | Terminal emulation |
| `@xterm/addon-fit` | 0.11.0 | Terminal auto-sizing |
| `node-pty` | 1.2.0-beta.15 | Pseudo-terminal for shell sessions |
| `undici` | 8.11.0 | HTTP client |
| `web-push` | 3.6.7 | Push notifications |
| `proper-lockfile` | 4.1.2 | File locking |
| `semver` | 7.8.5 | Version comparison |
| `js-yaml` | 5.2.3 | YAML parsing |

## Dev Dependencies

| Package | Purpose |
|---------|---------|
| `playwright` | E2E browser testing |
| `jiti` | TypeScript import in test files |
| `react-markdown` | Markdown rendering |
| `react-syntax-highlighter` | Code highlighting |
| `mermaid` | Diagram rendering |
| `katex` / `rehype-katex` | Math rendering |
| `mammoth` | Word document preview |
| `eslint` / `eslint-config-next` | Linting |

## Configuration Files

- `next.config.ts` — Next.js config (Turbopack, custom webpack)
- `tsconfig.json` — TypeScript with `@/` path alias to project root
- `postcss.config.mjs` — PostCSS with Tailwind
- `eslint.config.mjs` — ESLint configuration
- `package.json` — npm scripts, bin entry (`pi-web`)

## Runtime Configuration

- `~/.pi/agent/settings.json` — user preferences (layout, models, behavior)
- `~/.pi/agent/models.json` — model provider configuration
- `PI_CODING_AGENT_DIR` env var — agent data directory
- `PI_WEB_HOSTNAME` env var — listen hostname
- `PI_WEB_PASSWORD` env var — optional password auth
