import { writeFileSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { resolveStateHome } from "../state-home";
import type { TelemetrySnapshot, TelemetryCollector } from "./telemetry-collector";

export function telemetryDir(stateHome?: string): string {
  return join(stateHome ?? resolveStateHome(), "telemetry");
}

export function writeSnapshotAtomic(
  snapshot: TelemetrySnapshot,
  dir?: string,
): void {
  try {
    const target = dir ?? telemetryDir();
    mkdirSync(target, { recursive: true });
    const filePath = join(target, `${snapshot.sessionId}.json`);
    const tmpPath = join(target, `.${snapshot.sessionId}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2));
    renameSync(tmpPath, filePath);
  } catch {
    // TEL-04: write failure never propagates
  }
}

export class DebouncedWriter {
  private collector: TelemetryCollector;
  private intervalMs: number;
  private dir: string | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    collector: TelemetryCollector,
    intervalMs = 5_000,
    dir?: string,
  ) {
    this.collector = collector;
    this.intervalMs = intervalMs;
    this.dir = dir;
  }

  schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.intervalMs);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeSnapshotAtomic(this.collector.snapshot(), this.dir);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.flush();
  }
}
