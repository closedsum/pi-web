"use client";

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import type { BoardTask, TaskBoardData } from "@/lib/task-board";
import { useLayoutPreferences } from "@/hooks/useLayoutPreferences";
import { resolveModelDisplayName, getModelFamilyColor } from "@/lib/model-registry";

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

const POLL_INTERVAL_MS = 5_000;

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
  const isStatusWord = (p: string) => /^(PENDING|DONE|IN_PROGRESS|IN-PROGRESS|PLANNED|PLANNING|GAP|#\d+)/i.test(p);
  const isContextWord = (p: string) => /^(claude|pi-web|gsd-config|cropout|s\d+)/i.test(p) || /^\(s\d+\)$/i.test(p);
  const filtered = parts.filter((p) => !isStatusWord(p) && !isContextWord(p));
  if (filtered.length === 0) return { title };
  if (filtered.length === 1) return { title, tasktype: filtered[0] };
  if (filtered.length === 2) return { title, model: filtered[0], tasktype: filtered[1] };
  return { title, model: filtered[0], effort: filtered[1], tasktype: filtered.slice(2).join(" ") };
}

function hexToRgba(hex: string, alpha: number): string {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
  return `rgba(${parseInt(match[1], 16)},${parseInt(match[2], 16)},${parseInt(match[3], 16)},${alpha})`;
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 5px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 500,
      fontFamily: "var(--font-mono)",
      background: hexToRgba(color, 0.15),
      color,
      lineHeight: 1.5,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function formatElapsed(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (ms < 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return min > 0 ? `${hours}h${min}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

let minuteTick = 0;
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | null = null;
function subscribeMinuteTick(cb: () => void) {
  minuteListeners.add(cb);
  if (!minuteTimer) {
    minuteTimer = setInterval(() => { minuteTick++; minuteListeners.forEach((fn) => fn()); }, 60_000);
  }
  return () => {
    minuteListeners.delete(cb);
    if (minuteListeners.size === 0 && minuteTimer) { clearInterval(minuteTimer); minuteTimer = null; }
  };
}
function getMinuteTick() { return minuteTick; }
function useMinuteTick() { useSyncExternalStore(subscribeMinuteTick, getMinuteTick, getMinuteTick); }

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function BrailleSpinner({ color }: { color: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ display: "inline-block", width: 11, fontSize: 12, lineHeight: 1, color, flexShrink: 0, textAlign: "center", fontFamily: "var(--font-mono)" }}>
      {SPINNER_FRAMES[frame]}
    </span>
  );
}

function TaskItem({ task, isDead }: { task: BoardTask; isDead?: boolean }) {
  useMinuteTick();
  const { prefs: itemPrefs } = useLayoutPreferences();
  const [expanded, setExpanded] = useState(false);
  const parsed = parseSubject(task.subject);
  if (!parsed.title) return null;
  const showElapsed = task.status === "in_progress" && task.created_at;
  const hasTags = parsed.model || parsed.effort || parsed.tasktype || showElapsed;
  const isBlocked = task.status === "pending" && task.blockedBy.length > 0;

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
          fontSize: itemPrefs.taskFontSize,
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
          {isDead && (
            <span style={{
              display: "inline-block",
              padding: "1px 5px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              background: "rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              lineHeight: 1.5,
              whiteSpace: "nowrap",
              marginRight: 4,
            }}>
              DEAD
            </span>
          )}
          <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700, marginRight: 3 }}>#{task.id}</span>
          {hasTags && (
            <span style={{
              display: "inline-flex", gap: 2, marginRight: 4, verticalAlign: "baseline", alignItems: "baseline",
              background: "rgba(245, 158, 11, 0.10)", borderRadius: 4, padding: "1px 4px",
            }}>
              <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700 }}>[</span>
              {showElapsed && (
                <span style={{
                  display: "inline-block", padding: "1px 5px", borderRadius: 4,
                  fontSize: 10, fontWeight: 500, fontFamily: "var(--font-mono)",
                  background: "rgba(34, 197, 94, 0.15)", color: "#22c55e",
                  lineHeight: 1.5, whiteSpace: "nowrap",
                }}>
                  {formatElapsed(task.created_at)}
                </span>
              )}
              {parsed.model && <Tag label={resolveModelDisplayName(parsed.model)} color={getModelFamilyColor(parsed.model)} />}
              {parsed.effort && <Tag label={parsed.effort} color={itemPrefs.tagColorEffort} />}
              {parsed.tasktype && <Tag label={parsed.tasktype} color={itemPrefs.tagColorTasktype} />}
              <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700 }}>]</span>
            </span>
          )}
          {isBlocked && (
            <span style={{
              display: "inline-block",
              padding: "1px 5px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              background: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              lineHeight: 1.5,
              whiteSpace: "nowrap",
              marginRight: 4,
            }}>
              BLOCKED ({task.blockedBy.map((id) => `#${id}`).join(", ")})
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

function StatusSection({ status, tasks, deadKeys }: { status: BoardTask["status"]; tasks: BoardTask[]; deadKeys?: Set<string> }) {
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
        {status === "in_progress" ? (
          <BrailleSpinner color={STATUS_COLORS.in_progress} />
        ) : (
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: STATUS_COLORS[status], flexShrink: 0,
          }} />
        )}
        {STATUS_LABELS[status]}
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 2 }}>
          {tasks.length}
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: 4 }}>
          {tasks.map((task, i) => (
            <TaskItem key={`${task.session_id}-${task.id}-${i}`} task={task} isDead={deadKeys?.has(`${task.id}\0${task.session_id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskPanel({ cwd, onCollapse, onTaskCounts }: { cwd: string | null; onCollapse?: () => void; onTaskCounts?: (counts: { inProgress: number; pending: number; completed: number }) => void }) {
  const { prefs } = useLayoutPreferences();
  const [data, setData] = useState<TaskBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef(new Date().toISOString());
  const pollMs = prefs.taskPollInterval * 1000;

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
    timerRef.current = setInterval(fetchBoard, pollMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchBoard, pollMs]);

  const sessionStart = sessionStartRef.current;
  const STALE_MS = 4 * 60 * 60 * 1000;
  const grouped = new Map<BoardTask["status"], BoardTask[]>();
  for (const s of STATUS_ORDER) grouped.set(s, []);
  const deadTasks = new Set<string>();
  let sessionCompletedCount = 0;
  if (data) {
    const activeSessions = new Set<string>();
    for (const task of data.tasks) {
      if (task.created_at >= sessionStart) activeSessions.add(task.session_id);
    }
    for (const task of data.tasks) {
      if (task.status === "completed") {
        if (prefs.completedScope === "all" || (task.completed_at && task.completed_at >= sessionStart)) {
          grouped.get("completed")!.push(task);
          sessionCompletedCount++;
        }
      } else {
        const age = Date.now() - new Date(task.created_at).getTime();
        if (!activeSessions.has(task.session_id) && age > STALE_MS) {
          deadTasks.add(`${task.id}\0${task.session_id}`);
        }
        const list = grouped.get(task.status);
        if (list) list.push(task);
      }
    }
    for (const status of ["in_progress", "pending"] as const) {
      const list = grouped.get(status)!;
      list.sort((a, b) => {
        const aDead = deadTasks.has(`${a.id}\0${a.session_id}`) ? 1 : 0;
        const bDead = deadTasks.has(`${b.id}\0${b.session_id}`) ? 1 : 0;
        if (aDead !== bDead) return aDead - bDead;
        return a.created_at.localeCompare(b.created_at);
      });
    }
  }

  const ipCount = grouped.get("in_progress")?.length ?? 0;
  const pCount = grouped.get("pending")?.length ?? 0;
  const cCount = sessionCompletedCount;
  useEffect(() => { onTaskCounts?.({ inProgress: ipCount, pending: pCount, completed: cCount }); }, [ipCount, pCount, cCount, onTaskCounts]);

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
        {data && data.tasks.length > 0 && (
          <span style={{ fontSize: 10, display: "flex", gap: 6, whiteSpace: "nowrap" }}>
            {sessionCompletedCount > 0 && <span style={{ color: "#22c55e" }}><b>{sessionCompletedCount}</b> done</span>}
            {data.counts.in_progress > 0 && <span style={{ color: "#3b82f6" }}><b>{data.counts.in_progress}</b> active</span>}
            {data.counts.pending > 0 && <span style={{ color: "#f59e0b" }}><b>{data.counts.pending}</b> pending</span>}
          </span>
        )}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse panel"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", borderRadius: 4, transition: "color 0.12s" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
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
          <StatusSection key={status} status={status} tasks={grouped.get(status) ?? []} deadKeys={deadTasks} />
        ))}
      </div>
    </div>
  );
}
