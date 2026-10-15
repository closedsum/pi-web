# Concerns

## Large Component Files

Several components exceed 2000 lines and are difficult to navigate:
- `components/AppShell.tsx` — ~2700 lines (session management, layout, all state)
- `components/SessionSidebar.tsx` — ~2400 lines (session list, file explorer, sidebar actions)
- `components/MessageView.tsx` — ~2300 lines (message rendering, tool calls, custom messages)
- `components/ChatWindow.tsx` — ~1800 lines (chat rendering, streaming, pagination)

These could benefit from extraction into smaller sub-components, but splitting risks breaking the tightly-coupled state flow.

## Merge Conflict Residue

The recent merge from origin/main introduced some areas where our branch's custom features (task panel, extensions sidebar, streaming stats) were partially dropped to accept upstream's changes:
- `SessionSidebar.tsx` — accepted upstream's version entirely; our sidebar extensions, recent projects dropdown, and session history collapse features were lost
- `ChatWindow.tsx` — `onExtensionWidgetsChange` and `onRequestNewSession` props removed from the ChatWindow interface since upstream doesn't define them
- Some streaming stat features (session avg tps, per-message timing) may have subtle issues from the keep-both merge of `MessageView.tsx`

## Extension Test Coverage vs. Hook Coverage

- 71/92 gsd-config hooks covered (77%)
- 6 hooks need runtime infrastructure that doesn't exist in pi-web yet (daemon management, lock files, git history queries)
- 11 hooks classified as GSD-specific (Python import rules, spec validation)

## E2E Test Flakiness on Windows

- Scroll offset restoration tests are timing-sensitive — required `stableOffset` polling helper
- Process details collapse changes content height, making pixel-exact offset assertions unreliable
- Fixture sessions without RPC agents produce expected 500s that must be filtered
- The `git init` fixture project returns 500 from git status/diff APIs (no commits)

## Security Considerations

- `lib/path-security.ts` prevents path traversal but the rules are complex
- `PI_WEB_PASSWORD` authentication is over HTTP by default — only safe on loopback
- `bin/pi-web.js` now warns when listening on non-loopback without HTTPS
- Extension code loaded from `~/.pi/agent/extensions/` runs with full server privileges

## Performance

- `ChatWindow` and `MessageView` re-render heavily during streaming (upstream added `memo()` and `StreamingReply` to help)
- Upstream added `StreamingReply` component that only re-renders the streaming message, not the full chat
- `SessionSidebar` rebuilds the session list on every run completion
- Prism language loading is now on-demand (upstream perf improvement)
- Image caching, subagent relation cache, and view-cache sizing improvements from upstream

## Missing docs/ Directory

`CLAUDE.md` references `docs/INDEX.md` which doesn't exist — the doc chain index was never created. The doc chain checker flags this as a broken link.
