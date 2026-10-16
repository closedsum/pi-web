"use client";

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useHeartbeat(): void {
  useEffect(() => {
    const timer = setInterval(() => {
      fetch("/api/heartbeat", { method: "GET" }).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
