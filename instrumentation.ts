export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  const idleMs = parseInt(process.env.PI_IDLE_SHUTDOWN_MS || "", 10);
  if (idleMs > 0) {
    const { startIdleShutdown } = await import("@/lib/idle-shutdown");
    startIdleShutdown(idleMs);
  }
}
