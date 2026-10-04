import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";

export function registerNodeInstrumentation(): void {
  configureHttpDispatcher();

  const idleMs = parseInt(process.env.PI_WEB_IDLE_TIMEOUT_MS || "", 10);
  if (idleMs > 0) {
    import("@/lib/idle-shutdown").then(({ startIdleShutdown }) => startIdleShutdown(idleMs));
  }

  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
