export const BASE_POLL_MS = 5_000;
export const MAX_POLL_MS = 60_000;

export interface LaneDriverStatusDTO {
  status: "running" | "stopped" | "errored" | "stale" | "unknown";
  heartbeatAgeMs: number | null;
  reason: string;
  schemaVersion: 1 | 2;
  identityVerified: boolean;
}

export type PollResult =
  | { ok: true; data: LaneDriverStatusDTO }
  | { ok: false; reason: string };

interface VisibilityDoc {
  visibilityState: string;
  addEventListener(evt: string, fn: () => void): void;
  removeEventListener(evt: string, fn: () => void): void;
}

export interface PollerDeps {
  fetchFn: (signal: AbortSignal) => Promise<LaneDriverStatusDTO>;
  onResult: (result: PollResult) => void;
  doc?: VisibilityDoc;
  setT?: typeof setTimeout;
  clearT?: typeof clearTimeout;
  baseMs?: number;
  maxMs?: number;
}

export function nextDelay(errors: number): number {
  if (errors <= 0) return BASE_POLL_MS;
  return Math.min(BASE_POLL_MS * 2 ** errors, MAX_POLL_MS);
}

export function createLanePoller(deps: PollerDeps) {
  const {
    fetchFn,
    onResult,
    doc = typeof document !== "undefined" ? document : undefined,
    setT = setTimeout,
    clearT = clearTimeout,
    baseMs = BASE_POLL_MS,
    maxMs = MAX_POLL_MS,
  } = deps;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let errors = 0;
  let gen = 0;
  let ctrl: AbortController | null = null;
  let running = false;

  function delay() {
    if (errors <= 0) return baseMs;
    return Math.min(baseMs * 2 ** errors, maxMs);
  }

  function clear() {
    if (timer != null) {
      clearT(timer);
      timer = null;
    }
  }

  async function tick() {
    clear();
    ctrl?.abort();
    const myGen = ++gen;
    ctrl = new AbortController();
    try {
      const data = await fetchFn(ctrl.signal);
      if (myGen !== gen) return;
      errors = 0;
      onResult({ ok: true, data });
    } catch (e: unknown) {
      if (myGen !== gen) return;
      if (e && typeof e === "object" && "name" in e && e.name === "AbortError") return;
      errors++;
      onResult({
        ok: false,
        reason: String(
          e && typeof e === "object" && "message" in e ? e.message : e,
        ),
      });
    }
    if (myGen === gen && running && doc?.visibilityState === "visible") {
      timer = setT(tick, delay());
    }
  }

  function onVis() {
    if (!running) return;
    if (doc?.visibilityState === "visible") {
      tick();
    } else {
      gen++;
      ctrl?.abort();
      clear();
    }
  }

  return {
    start() {
      running = true;
      doc?.addEventListener("visibilitychange", onVis);
      if (doc?.visibilityState === "visible") {
        tick();
      }
    },
    stop() {
      running = false;
      gen++;
      ctrl?.abort();
      clear();
      doc?.removeEventListener("visibilitychange", onVis);
    },
  };
}
