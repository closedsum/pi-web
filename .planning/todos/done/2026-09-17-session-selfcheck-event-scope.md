---
created: 2026-09-17T21:50:00.000Z
title: Move gsd-session-selfcheck to session_start only in Pi
area: extensions
files:
  - test/extensions/gsd-session-selfcheck/
---

## Problem

gsd-session-selfcheck fires on ALL events (PreToolUse, PostToolUse, UserPromptSubmit), injecting 1176 bytes (294 tokens) every time. It runs deploy.py --status which takes 5.9s. This is the single most expensive hook — 294 tokens * N tool calls per session = significant wasted context.

## Solution

In Pi, register this as a `session_start` handler only. The checks (junction drift, hook registrations, template drift) only need to run once at session start, not on every tool call. Estimated savings: ~294 tokens per tool call after the first.
