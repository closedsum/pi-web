import { configureHttpDispatcher, readHttpIdleTimeoutMs } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";

export function registerNodeInstrumentation(): void {
  // The pi CLI applies settings' `httpIdleTimeoutMs` to the same undici
  // body/header timeouts, so a Web UI session gets the timeout the user
  // configured. Without it the built-in five minutes aborts a provider stream
  // that stays quiet for longer, which a CLI session tolerates.
  configureHttpDispatcher(readHttpIdleTimeoutMs());

  const DEFAULT_IDLE_MS = 10 * 60 * 1000;
  const rawIdle = process.env.PI_WEB_IDLE_TIMEOUT_MS;
  const idleMs = rawIdle !== undefined ? parseInt(rawIdle, 10) : DEFAULT_IDLE_MS;
  if (idleMs > 0) {
    import("@/lib/idle-shutdown").then(({ startIdleShutdown }) => startIdleShutdown(idleMs));
  }

  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);

  // Next evaluates a route's code on its first request, so the first
  // /api/sessions used to pay for importing the whole pi SDK, seconds on
  // Windows (#964). Start that import now, unawaited so register() stays fast:
  // it overlaps the browser opening, and the routes reuse Node's cached module.
  // A failure is left for the routes' own import to report.
  import("@earendil-works/pi-coding-agent").catch(() => {});
}
