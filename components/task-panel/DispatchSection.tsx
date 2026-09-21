"use client";

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import type { DispatchItem, DispatchStatusData } from "@/lib/dispatch-status";
import { resolveModelDisplayName, getModelFamilyColor } from "@/lib/model-registry";

const CATEGORY_COLORS: Record<string, string> = {
  active: "#3b82f6",
  success: "#22c55e",
  failed: "#ef4444",
  blocked: "#f59e0b",
};

const CATEGORY_LABELS: Record<string, string> = {
  active: "Active",
  success: "Done",
  failed: "Failed",
  blocked: "Blocked",
};

const PHASE_LABELS: Record<string, string> = {
  "init/preflight": "preflight",
  "init/worktree": "worktree",
  impl: "implementing",
  review: "reviewing",
  fix: "fixing",
  terminal: "terminal",
  blocked_policy: "blocked",
};

function formatElapsed(startedAt: string, finishedAt?: string): string {
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return "";
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;
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

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 5px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 500,
      fontFamily: "var(--font-mono)",
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color,
      lineHeight: 1.5,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function DispatchItemRow({ item }: { item: DispatchItem }) {
  useMinuteTick();
  const [expanded, setExpanded] = useState(false);
  const catColor = CATEGORY_COLORS[item.displayCategory] || "#888";
  const isActive = item.displayCategory === "active";
  const phaseLabel = item.phase ? (PHASE_LABELS[item.phase] || item.phase) : undefined;

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
        {isActive ? (
          <BrailleSpinner color={catColor} />
        ) : (
          <span style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: catColor,
            flexShrink: 0,
            marginTop: 4,
          }} />
        )}
        <span style={{ minWidth: 0, wordBreak: "break-word", flex: 1 }}>
          <span style={{ display: "inline-flex", gap: 2, marginRight: 4, verticalAlign: "baseline", alignItems: "baseline" }}>
            {isActive && item.startedAt && (
              <Tag label={formatElapsed(item.startedAt)} color="#22c55e" />
            )}
            {phaseLabel && (
              <Tag label={phaseLabel} color={catColor} />
            )}
            {item.source === "lane" && <Tag label="lane" color="#8b5cf6" />}
            {item.source === "ue_dispatch" && <Tag label="ue" color="#f97316" />}
          </span>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{item.title}</span>
        </span>
      </button>
      {expanded && (
        <div style={{
          fontSize: 11,
          color: "var(--text-muted)",
          padding: "2px 0 4px 12px",
          lineHeight: 1.5,
          wordBreak: "break-word",
        }}>
          <div>Status: {item.status}{item.phase ? ` (${item.phase})` : ""}</div>
          {item.startedAt && <div>Started: {new Date(item.startedAt).toLocaleTimeString()}</div>}
          {item.finishedAt && <div>Finished: {new Date(item.finishedAt).toLocaleTimeString()}{" "}({formatElapsed(item.startedAt, item.finishedAt)})</div>}
          {item.pid && <div>PID: {item.pid}</div>}
          {item.error && <div style={{ color: "#ef4444" }}>Error: {item.error}</div>}
          {item.steps && item.steps.length > 0 && (
            <div style={{ marginTop: 2 }}>
              {item.steps.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ color: s.done ? "#22c55e" : "var(--text-dim)" }}>{s.done ? "✓" : "○"}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DispatchSection({ cwd, pollMs }: { cwd: string | null; pollMs: number }) {
  const [data, setData] = useState<DispatchStatusData | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef(new Date().toISOString());

  const fetchDispatches = useCallback(async () => {
    if (!cwd) return;
    try {
      const res = await fetch(`/api/dispatch-status?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) return;
      const json = await res.json() as DispatchStatusData;
      setData(json);
    } catch {
      // ignore fetch errors
    }
  }, [cwd]);

  useEffect(() => {
    fetchDispatches();
    timerRef.current = setInterval(fetchDispatches, pollMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchDispatches, pollMs]);

  const sessionDispatches = (data?.dispatches ?? []).filter((d) => d.startedAt >= sessionStartRef.current);

  if (sessionDispatches.length === 0) return null;

  const active = sessionDispatches.filter((d) => d.displayCategory === "active");
  const terminal = sessionDispatches.filter((d) => d.displayCategory !== "active");

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 0",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-muted)",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}>
        Lanes
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {sessionDispatches.length}
        </span>
        {active.length > 0 && (
          <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>
            {active.length} active
          </span>
        )}
      </div>
      {active.map((item) => (
        <DispatchItemRow key={`${item.source}-${item.id}`} item={item} />
      ))}
      {terminal.length > 0 && (
        <TerminalSection items={terminal} />
      )}
    </div>
  );
}

function TerminalSection({ items }: { items: DispatchItem[] }) {
  const [open, setOpen] = useState(false);
  const successCount = items.filter((d) => d.displayCategory === "success").length;
  const failedCount = items.filter((d) => d.displayCategory === "failed").length;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          width: "100%",
          padding: "4px 0",
          background: "none",
          border: "none",
          color: "var(--text-dim)",
          cursor: "pointer",
          fontSize: 10,
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <svg
          width="8" height="8" viewBox="0 0 10 10"
          fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
        <span>
          {items.length} finished
          {successCount > 0 && <span style={{ color: "#22c55e", marginLeft: 4 }}>{successCount} ok</span>}
          {failedCount > 0 && <span style={{ color: "#ef4444", marginLeft: 4 }}>{failedCount} failed</span>}
        </span>
      </button>
      {open && items.map((item) => (
        <DispatchItemRow key={`${item.source}-${item.id}`} item={item} />
      ))}
    </div>
  );
}
