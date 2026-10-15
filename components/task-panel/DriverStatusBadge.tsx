"use client";

import { useLaneDriverStatus } from "@/hooks/useLaneDriverStatus";
import { formatHeartbeatAge } from "@/lib/lane-driver-poller";

const STATUS_BADGE_COLORS: Record<string, string> = {
  running: "#22c55e",
  stopped: "#6b7280",
  errored: "#ef4444",
  stale: "#f59e0b",
  unknown: "#64748b",
};

function hexToRgba(hex: string, alpha: number): string {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
  return `rgba(${parseInt(match[1], 16)},${parseInt(match[2], 16)},${parseInt(match[3], 16)},${alpha})`;
}

export function DriverStatusBadge({ cwd }: { cwd: string | null }) {
  const { status, loading } = useLaneDriverStatus(cwd);

  if (loading && !status) return null;
  if (!status) return null;

  const color = STATUS_BADGE_COLORS[status.status] ?? STATUS_BADGE_COLORS.unknown;
  const ageText = formatHeartbeatAge(status.heartbeatAgeMs);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 500,
        fontFamily: "var(--font-mono)",
        background: hexToRgba(color, 0.15),
        color,
        lineHeight: 1.5,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {status.status}
      {ageText && (
        <span style={{ opacity: 0.7 }}>({ageText})</span>
      )}
    </span>
  );
}
