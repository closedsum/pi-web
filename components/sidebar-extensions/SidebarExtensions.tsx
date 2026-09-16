"use client";

import { useState } from "react";
import { ExtensionWidgets } from "@/components/ExtensionWidgets";
import { loadExtensionsOpen, saveExtensionsOpen } from "@/lib/sidebar-extensions-state";
import type { ExtensionWidgetItem } from "@/lib/types";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function SidebarExtensions({
  widgets,
  storage,
}: {
  widgets: ExtensionWidgetItem[];
  storage?: StorageLike | null;
}) {
  const [open, setOpen] = useState(() => loadExtensionsOpen(storage ?? undefined));

  if (widgets.length === 0) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flex: open ? "1 1 0" : "0 0 auto",
        minHeight: 0,
        overflow: "hidden",
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
            {widgets.length}
          </span>
        </button>
      </div>
      {open && (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <ExtensionWidgets widgets={widgets} />
        </div>
      )}
    </div>
  );
}
