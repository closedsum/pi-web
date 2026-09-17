"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_PREFIX = "pi-layout:";

export const LAYOUT_DEFAULTS = {
  taskPanelEnabled: true,
  taskPollInterval: 5,
  completedScope: "session" as "session" | "all",
  clearSessionsOnNew: true,
  contextBarColor: "rgba(0,255,0,0.95)",
  processDetailsCollapsed: true,
  taskFontSize: 12,
  tagColorModel: "#a78bfa",
  tagColorEffort: "#60a5fa",
  tagColorTasktype: "#facc15",
};

export type LayoutPreferences = typeof LAYOUT_DEFAULTS;

export function readPref<K extends keyof LayoutPreferences>(key: K): LayoutPreferences[K] {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (stored === null) return LAYOUT_DEFAULTS[key];
    if (typeof LAYOUT_DEFAULTS[key] === "boolean") return (stored === "true") as LayoutPreferences[K];
    if (typeof LAYOUT_DEFAULTS[key] === "number") return Number(stored) as LayoutPreferences[K];
    return stored as LayoutPreferences[K];
  } catch {
    return LAYOUT_DEFAULTS[key];
  }
}

function writePref<K extends keyof LayoutPreferences>(key: K, value: LayoutPreferences[K]): void {
  try { window.localStorage.setItem(STORAGE_PREFIX + key, String(value)); } catch {}
}

export function useLayoutPreferences() {
  const [prefs, setPrefs] = useState<LayoutPreferences>(LAYOUT_DEFAULTS);

  useEffect(() => {
    const loaded: LayoutPreferences = { ...LAYOUT_DEFAULTS };
    for (const key of Object.keys(LAYOUT_DEFAULTS) as (keyof LayoutPreferences)[]) {
      (loaded as Record<string, unknown>)[key] = readPref(key);
    }
    setPrefs(loaded);
  }, []);

  const setPref = useCallback(<K extends keyof LayoutPreferences>(key: K, value: LayoutPreferences[K]) => {
    writePref(key, value);
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetAll = useCallback(() => {
    for (const key of Object.keys(LAYOUT_DEFAULTS) as (keyof LayoutPreferences)[]) {
      try { window.localStorage.removeItem(STORAGE_PREFIX + key); } catch {}
    }
    setPrefs({ ...LAYOUT_DEFAULTS });
  }, []);

  return { prefs, setPref, resetAll };
}
