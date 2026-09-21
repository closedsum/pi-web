---
created: 2026-09-21T22:35:00.000Z
title: Session-scoped task panel with dispatch queue
area: ui
files:
  - components/task-panel/TaskPanel.tsx:300
  - components/task-panel/DispatchSection.tsx:193
  - lib/task-board.ts
---

## Problem

The TaskPanel shows all tasks from `.planning/threads/board.jsonl` across all
sessions. Lane dispatch items appear separately in DispatchSection. The user
wants a unified view scoped to the active session: only that session's tasks
visible, with dispatched lanes shown as a queue alongside tasks.

## Solution

1. Filter `board.jsonl` tasks by session ID in the TaskPanel component
2. Merge DispatchSection lane items into the task list as queue entries
3. Pass `sessionId` through to the filtering logic (already available as a prop)
