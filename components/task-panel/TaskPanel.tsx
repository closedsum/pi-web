"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BoardTask, TaskBoardData } from "@/lib/task-board";

const STATUS_ORDER: BoardTask["status"][] = ["in_progress", "pending", "completed"];
const STATUS_LABELS: Record<BoardTask["status"], string> = {
  in_progress: "In Progress",
  pending: "Pending",
  completed: "Completed",
};
const STATUS_COLORS: Record<BoardTask["status"], string> = {
  in_progress: "#3b82f6",
  pending: "#f59e0b",
  completed: "#22c55e",
};

const POLL_INTERVAL_MS = 10_000;

const TAG_COLORS: Record<string, { bg: string; fg: string }> = {
  model: { bg: "rgba(139, 92, 246, 0.15)", fg: "#a78bfa" },
  effort: { bg: "rgba(59, 130, 246, 0.15)", fg: "#60a5fa" },
  tasktype: { bg: "rgba(234, 179, 8, 0.15)", fg: "#facc15" },
};

interface ParsedSubject {
  title: string;
  model?: string;
  effort?: string;
  tasktype?: string;
}

function parseSubject(subject: string): ParsedSubject {
  const match = subject.match(/^\[([^\]]*)\]\s*([\s\S]*)/);
  if (!match) return { title: subject };
  const prefix = match[1].trim();
  const title = match[2].trim();
  const parts = prefix.split(/\s+/);
  const statusWords = new Set(["PENDING", "DONE", "IN_PROGRESS", "IN-PROGRESS", "PLANNED", "PLANNING", "gap", "claude", "pi-web", "gsd-config"]);
  const filtered = parts.filter((p) => !statusWords.has(p) && !statusWords.has(p.toUpperCase()));
  if (filtered.length === 0) return { title };
  if (filtered.length === 1) return { title, tasktype: filtered[0] };
  if (filtered.length === 2) return { title, model: filtered[0], tasktype: filtered[1] };
  return { title, model: filtered[0], effort: filtered[1], tasktype: filtered.slice(2).join(" ") };
}

function Tag({ label, kind }: { label: string; kind: "model" | "effort" | "tasktype" }) {
  const colors = TAG_COLORS[kind];
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 5px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 500,
      fontFamily: "var(--font-mono)",
      background: colors.bg,
      color: colors.fg,
      lineHeight: 1.5,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function TaskItem({ task }: { task: BoardTask }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseSubject(task.subject);
  if (!parsed.title) return null;
  const hasTags = parsed.model || parsed.effort || parsed.tasktype;

  return (
    <div style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          width: "100%",
          padding: "4px 0",
          background: "none",
          border: "none",
          color: "var(--text)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 12,
          lineHeight: 1.4,
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: STATUS_COLORS[task.status],
            flexShrink: 0,
            marginTop: 4,
          }}
        />
        <span style={{ minWidth: 0, wordBreak: "break-word" }}>
          {hasTags && (
            <span style={{ display: "inline-flex", gap: 3, marginRight: 4, verticalAlign: "baseline" }}>
              {parsed.model && <Tag label={parsed.model} kind="model" />}
              {parsed.effort && <Tag label={parsed.effort} kind="effort" />}
              {parsed.tasktype && <Tag label={parsed.tasktype} kind="tasktype" />}
            </span>
          )}
          {parsed.title}
        </span>
      </button>
      {expanded && task.description && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            padding: "2px 0 4px 12px",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {task.description}
        </div>
      )}
    </div>
  );
}

function StatusSection({ status, tasks }: { status: BoardTask["status"]; tasks: BoardTask[] }) {
  const [open, setOpen] = useState(status !== "completed");
  if (tasks.length === 0) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 0",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
            flexShrink: 0,
          }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: STATUS_COLORS[status],
            flexShrink: 0,
          }}
        />
        {STATUS_LABELS[status]}
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 2 }}>
          {tasks.length}
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: 4 }}>
          {tasks.map((task, i) => (
            <TaskItem key={`${task.session_id}-${task.id}-${i}`} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskPanel({ cwd }: { cwd: string | null }) {
  const [data, setData] = useState<TaskBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBoard = useCallback(async () => {
    if (!cwd) return;
    try {
      const res = await fetch(`/api/task-board?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = await res.json() as TaskBoardData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd]);

  useEffect(() => {
    fetchBoard();
    timerRef.current = setInterval(fetchBoard, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchBoard]);

  const grouped = new Map<BoardTask["status"], BoardTask[]>();
  for (const s of STATUS_ORDER) grouped.set(s, []);
  if (data) {
    for (const task of data.tasks) {
      const list = grouped.get(task.status);
      if (list) list.push(task);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          height: "calc(36px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          padding: "0 10px",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          Tasks
        </span>
        {data && (
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
            {data.counts.in_progress + data.counts.pending} active
          </span>
        )}
        <button
          onClick={fetchBoard}
          title="Refresh"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            borderRadius: 4,
            transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "4px 10px 8px" }}>
        {!cwd && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0", textAlign: "center" }}>
            No project selected
          </div>
        )}
        {cwd && error && (
          <div style={{ fontSize: 12, color: "#dc2626", padding: "12px 0", textAlign: "center" }}>
            {error}
          </div>
        )}
        {cwd && data && data.tasks.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0", textAlign: "center" }}>
            No tasks found
          </div>
        )}
        {data && STATUS_ORDER.map((status) => (
          <StatusSection key={status} status={status} tasks={grouped.get(status) ?? []} />
        ))}
      </div>
    </div>
  );
}
