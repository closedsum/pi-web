const g = globalThis as unknown as { __piLastRequestAt: number };
g.__piLastRequestAt = Date.now();

export function touchActivity(): void {
  g.__piLastRequestAt = Date.now();
}

export function startIdleShutdown(timeoutMs: number): void {
  const timer = setInterval(() => {
    const idle = Date.now() - g.__piLastRequestAt;
    if (idle > timeoutMs) {
      console.log(`[pi-web] No browser activity for ${Math.round(idle / 1000)}s — shutting down.`);
      process.exit(0);
    }
  }, 5_000);
  timer.unref();
}
