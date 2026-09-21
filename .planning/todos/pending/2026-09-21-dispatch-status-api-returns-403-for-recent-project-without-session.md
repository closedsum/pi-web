---
created: 2026-09-21T22:24:47.232Z
title: dispatch-status API returns 403 for recent-project without session
area: api
files:
  - lib/file-access.ts:20-49
  - app/api/dispatch-status/route.ts:12-15
---

## Problem

When a user loads a project via "recent projects" without creating a chat session,
the dispatch-status API returns 403 because `getAllowedFileRoots()` only includes
paths from active sessions (`listAllSessions().cwd`). The project's `.planning/impl-lanes/`
data is inaccessible, so the DispatchSection component never receives dispatch data
for that project.

Observed in server logs: `GET /api/dispatch-status?cwd=CropoutSampleProject` returns
403 repeatedly while `cwd=pi-web` (the host) returns 200.

## Solution

Expand `getAllowedFileRoots()` to also include recent-project paths, or pass
`activeCwd` into the session-awareness layer so browsed-but-not-chatted projects
are allowed. Alternative: dispatch-status could bypass the session-based access
check since it only reads `.planning/` directories (low risk).
