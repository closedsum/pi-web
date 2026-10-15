# External Integrations

## AI Provider APIs

Pi-web connects to AI providers through the `@earendil-works/pi-ai` abstraction layer:
- Provider credentials stored in `~/.pi/agent/credentials/` via `lib/provider-credential-store.ts`
- Model catalog discovery via `lib/model-catalog.ts` and `lib/model-discovery.ts`
- Model scoping (enabled/disabled) via `lib/model-scope.ts`
- Provider usage tracking via `lib/provider-usage.ts`

## MCP (Model Context Protocol)

Full MCP server management:
- `lib/mcp-host.ts` — MCP server lifecycle, connection, tool routing
- `lib/mcp-config-file.ts` — reads `mcp.json` configuration
- `lib/mcp-transport.ts` — stdio/SSE transport support
- `lib/mcp-sign-in.ts` / `lib/mcp-sign-out.ts` — OAuth authentication flow
- `lib/mcp-add.ts` — adding new MCP servers
- `lib/mcp-import.ts` — importing MCP configs from CLI tools
- `lib/mcp-read-only-policy.ts` — read-only tool policy extension

## File System

- `lib/file-access.ts` — file read/write with path security
- `lib/path-security.ts` — prevents path traversal attacks
- `lib/file-upload.ts` — file attachment handling
- `lib/directory-browser.ts` — directory listing for file explorer
- `lib/git-status.ts` / `lib/git-changes.ts` — git integration for diff views
- `lib/worktree.ts` — git worktree management

## Terminal / PTY

- `lib/terminal-manager.ts` — manages node-pty pseudo-terminal sessions
- `lib/terminal-client.ts` — client-side terminal connection
- `lib/terminal-input.ts` — input handling (paste, mobile keyboards)
- `lib/terminal-extra-keys.ts` — Termux-style extra keys for touch screens

## Push Notifications

- `lib/web-push.ts` — server-side VAPID push subscription
- `lib/push-client.ts` — client-side push subscription
- `lib/browser-notifications.ts` — browser Notification API wrapper
- `public/sw.js` — service worker for push event handling

## Session Management (Internal)

- `lib/rpc-manager.ts` — RPC session lifecycle (start, stop, message routing)
- `lib/session-reader.ts` — JSONL session file reader
- `lib/session-list-scanner.ts` — session directory scanner
- `lib/session-liveness.ts` — running session detection
- `lib/subagent-runtime.ts` — subagent session management

## GSD Pipeline Integration

- `lib/gsd-lane-extension.ts` — orchestrator mode enforcement, DispatchLane/CheckLaneStatus tools
- `lib/dispatch-status.ts` — reads `.planning/impl-lanes/p-*.json` lane manifests
- `lib/task-board.ts` — reads `.planning/threads/board.jsonl` task data
- `lib/extensions/tool-blockers.ts` — 21 block rules ported from Claude CLI hooks

## No External Databases

Pi-web uses no databases — all state is file-based:
- Sessions: JSONL files in agent dir
- Settings: JSON files in `~/.pi/agent/`
- Task board: JSONL in `.planning/threads/`
- Lane state: JSON manifests in `.planning/impl-lanes/`
