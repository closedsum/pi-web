# Architecture

## Pattern

**Next.js App Router + RPC Session Manager**

Pi-web is a full-stack Next.js application serving a coding agent UI. The server manages agent sessions via `rpc-manager.ts`, which wraps the pi-coding-agent SDK. The client renders a chat-based IDE with sidebar, terminal, file explorer, and task panel.

## Layers

```
┌─────────────────────────────────────────────┐
│  Browser (React)                            │
│  AppShell → SessionSidebar + ChatWindow     │
│  Components: MessageView, ChatInput,        │
│    ModelSelector, TaskPanel, FileViewer      │
├─────────────────────────────────────────────┤
│  Next.js API Routes (app/api/)              │
│  /api/agent/[id]      — RPC session control │
│  /api/sessions/       — session CRUD        │
│  /api/files/          — file read/write     │
│  /api/models/         — model catalog       │
│  /api/mcp/            — MCP server mgmt     │
│  /api/terminal/       — PTY management      │
│  /api/dispatch-status — lane pipeline       │
│  /api/task-board      — task board data     │
├─────────────────────────────────────────────┤
│  RPC Manager (lib/rpc-manager.ts)           │
│  AgentSessionWrapper — wraps pi SDK session │
│  Extension loading, model scope, subagents  │
├─────────────────────────────────────────────┤
│  Pi SDK (@earendil-works/pi-*)              │
│  Agent core, AI providers, coding agent,    │
│  MCP protocol, TUI, codemode, telemetry     │
└─────────────────────────────────────────────┘
```

## Data Flow

1. **User sends message** → `ChatInput` → POST `/api/agent/[id]` with `{type: "prompt", content}`
2. **Server routes to RPC session** → `rpc-manager.ts` finds/creates `AgentSessionWrapper`
3. **Agent processes** → pi-coding-agent runs tools, streams events via SSE
4. **Client receives events** → `/api/agent/[id]/events` SSE stream → `useAgentSession` hook
5. **UI updates** → `ChatWindow` renders messages, tool calls, streaming content

## Key Abstractions

### AgentSessionWrapper (`lib/rpc-manager.ts`)
Central abstraction wrapping a pi-coding-agent session. Manages:
- Session lifecycle (start, send, stop, shutdown)
- Extension loading (tool blockers, GSD lanes, MCP policy)
- Idle timeout and resource cleanup
- Subagent creation and tracking
- Model scope resolution

### Extension System (`lib/extensions/`)
Modular plugin framework for tool-call interception:
- `tool-blockers.ts` — 21 `BlockRule` functions, evaluated per tool call
- `lib/gsd-lane-extension.ts` — orchestrator mode with allow-list gate
- `lib/builtin-extensions.ts` — loads extensions from agent dir
- `lib/subagent-extension.ts` — built-in subagent tool

### Streaming Architecture
- `lib/streaming-message.ts` — accumulates streaming chunks into renderable messages
- `lib/stream-token-rate.ts` — calculates tokens/second rate
- `lib/agent-event-stream.ts` — SSE event stream protocol

## Entry Points

- `bin/pi-web.js` — CLI entry, starts Next.js server
- `app/page.tsx` — main page (single-page app)
- `app/layout.tsx` — root layout with metadata
- `app/login/page.tsx` — password login page
- `components/AppShell.tsx` — top-level component (2700+ lines)
