"use client";

import { useState } from "react";
import { AnsiText } from "@/components/AnsiText";
import { formatExtensionWidgetContent } from "@/components/ExtensionWidgets";
import { loadExtensionsOpen, saveExtensionsOpen } from "@/lib/sidebar-extensions-state";
import type { ExtensionWidgetItem } from "@/lib/types";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const HIDDEN_WIDGETS = new Set(["gsd-task", "gsd-tasks"]);

const WIDGET_DISPLAY_NAMES: Record<string, string> = {
  "gsd-task": "Checklist",
  "gsd-tasks": "Checklist",
};

function widgetDisplayName(key: string): string {
  return WIDGET_DISPLAY_NAMES[key] ?? key;
}

export function SidebarExtensions({
  widgets,
  storage,
}: {
  widgets: ExtensionWidgetItem[];
  storage?: StorageLike | null;
}) {
  const [open, setOpen] = useState(() => loadExtensionsOpen(storage ?? undefined));
  const visibleWidgets = widgets.filter(w => !HIDDEN_WIDGETS.has(w.key));

  if (visibleWidgets.length === 0) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        ...(open ? { minHeight: 150, maxHeight: "50%" } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={() =>
            setOpen((prev) => {
              const next = !prev;
              saveExtensionsOpen(next, storage ?? undefined);
              return next;
            })
          }
          aria-expanded={open}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textAlign: "left",
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
          Extensions
          <span
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              marginLeft: 2,
            }}
          >
            {visibleWidgets.length}
          </span>
        </button>
      </div>
      {open && (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 10px 8px" }}>
          {visibleWidgets.map((widget) => (
            <div key={widget.key} style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                {widgetDisplayName(widget.key)}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-hover)",
                  borderRadius: 6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--text)",
                  overflowX: "auto",
                }}
              >
                <AnsiText text={formatExtensionWidgetContent(widget.lines)} />
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
