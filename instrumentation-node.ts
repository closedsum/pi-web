import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";

export function registerNodeInstrumentation(): void {
  configureHttpDispatcher();

  const DEFAULT_IDLE_MS = 10 * 60 * 1000;
  const rawIdle = process.env.PI_WEB_IDLE_TIMEOUT_MS;
  const idleMs = rawIdle !== undefined ? parseInt(rawIdle, 10) : DEFAULT_IDLE_MS;
  if (idleMs > 0) {
    import("@/lib/idle-shutdown").then(({ startIdleShutdown }) => startIdleShutdown(idleMs));
  }

  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
