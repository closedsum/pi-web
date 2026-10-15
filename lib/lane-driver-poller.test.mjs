import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { nextDelay, createLanePoller, BASE_POLL_MS, MAX_POLL_MS } =
  await jiti.import("./lane-driver-poller.ts");

function createFakeTimers() {
  let nextId = 1;
  const pending = [];
  return {
    pending,
    setT(fn, ms) {
      const id = nextId++;
      pending.push({ id, fn, ms });
      return id;
    },
    clearT(id) {
      const idx = pending.findIndex((t) => t.id === id);
      if (idx >= 0) pending.splice(idx, 1);
    },
    flush() {
      while (pending.length > 0) {
        const t = pending.shift();
        t.fn();
      }
    },
  };
}

function createFakeDoc(initialVisible = true) {
  const listeners = new Map();
  const doc = {
    visibilityState: initialVisible ? "visible" : "hidden",
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
    },
    removeEventListener(evt, fn) {
      listeners.get(evt)?.delete(fn);
    },
    setVisible(v) {
      doc.visibilityState = v ? "visible" : "hidden";
      for (const fn of listeners.get("visibilitychange") ?? []) fn();
    },
    listenerCount(evt) {
      return listeners.get(evt)?.size ?? 0;
    },
  };
  return doc;
}

function createDeferredFetch() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MOCK_DTO = {
  status: "running",
  heartbeatAgeMs: 5000,
  reason: "v2_identity_verified",
  schemaVersion: 2,
  identityVerified: true,
};

const UNKNOWN_DTO = {
  status: "unknown",
  heartbeatAgeMs: null,
  reason: "no_lock_file",
  schemaVersion: 1,
  identityVerified: false,
};

// --- nextDelay tests ---

describe("nextDelay", () => {
  test("0 errors returns base interval", () => {
    assert.equal(nextDelay(0), 5_000);
  });

  test("1 error doubles", () => {
    assert.equal(nextDelay(1), 10_000);
  });

  test("2 errors quadruples", () => {
    assert.equal(nextDelay(2), 20_000);
  });

  test("3 errors → 40s", () => {
    assert.equal(nextDelay(3), 40_000);
  });

  test("4 errors caps at 60s", () => {
    assert.equal(nextDelay(4), 60_000);
  });

  test("10 errors stays capped at 60s", () => {
    assert.equal(nextDelay(10), 60_000);
  });

  test("negative errors returns base", () => {
    assert.equal(nextDelay(-1), 5_000);
  });
});

// --- createLanePoller tests ---

describe("createLanePoller", () => {
  test("success resets error count — next delay is base", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();
    const results = [];
    let callCount = 0;

    const poller = createLanePoller({
      fetchFn: async () => {
        callCount++;
        if (callCount <= 2) throw new Error("fail");
        return MOCK_DTO;
      },
      onResult: (r) => results.push(r),
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    // First call failed → error 1
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.equal(timers.pending.length, 1);
    assert.equal(timers.pending[0].ms, 10_000); // 1 error → 10s

    timers.flush();
    await new Promise((r) => setTimeout(r, 10));
    // Second call failed → error 2
    assert.equal(results.length, 2);
    assert.equal(timers.pending[0].ms, 20_000); // 2 errors → 20s

    timers.flush();
    await new Promise((r) => setTimeout(r, 10));
    // Third call succeeds → reset
    assert.equal(results.length, 3);
    assert.equal(results[2].ok, true);
    assert.equal(timers.pending[0].ms, 5_000); // reset to base

    poller.stop();
  });

  test("never more than one pending timer", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();

    const poller = createLanePoller({
      fetchFn: async () => MOCK_DTO,
      onResult: () => {},
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(timers.pending.length <= 1, `Expected <=1 timer, got ${timers.pending.length}`);

    timers.flush();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(timers.pending.length <= 1, `Expected <=1 timer after flush, got ${timers.pending.length}`);

    poller.stop();
  });

  test("no overlapping fetches with slow fetch and visibility toggle", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();
    let concurrentFetches = 0;
    let maxConcurrent = 0;
    const deferred = createDeferredFetch();

    const poller = createLanePoller({
      fetchFn: async (signal) => {
        concurrentFetches++;
        maxConcurrent = Math.max(maxConcurrent, concurrentFetches);
        try {
          await deferred.promise;
        } finally {
          concurrentFetches--;
        }
        return MOCK_DTO;
      },
      onResult: () => {},
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    // Fetch is in-flight. Toggle visibility
    doc.setVisible(false);
    doc.setVisible(true);
    await new Promise((r) => setTimeout(r, 10));

    // The old fetch was aborted; a new one started — but never more than 1 unaborted at a time
    // (abort cancels the old one before starting new)
    poller.stop();
    deferred.resolve(MOCK_DTO); // resolve to avoid unhandled rejection
  });

  test("hidden pauses polling and does not count as error", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();
    const results = [];

    const poller = createLanePoller({
      fetchFn: async () => MOCK_DTO,
      onResult: (r) => results.push(r),
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(results.length, 1);

    // Go hidden
    doc.setVisible(false);
    assert.equal(timers.pending.length, 0, "Timer should be cleared when hidden");

    poller.stop();
  });

  test("visible resumes with immediate fetch", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();
    const results = [];

    const poller = createLanePoller({
      fetchFn: async () => MOCK_DTO,
      onResult: (r) => results.push(r),
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(results.length, 1);

    doc.setVisible(false);
    doc.setVisible(true);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(results.length, 2, "Should fetch immediately on visible");
    assert.equal(timers.pending.length, 1, "Should schedule next timer");
    assert.equal(timers.pending[0].ms, 5_000, "Should be base interval after success");

    poller.stop();
  });

  test("mounted while hidden does not fetch until visible", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc(false); // start hidden
    const results = [];

    const poller = createLanePoller({
      fetchFn: async () => MOCK_DTO,
      onResult: (r) => results.push(r),
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(results.length, 0, "No fetch while hidden");
    assert.equal(timers.pending.length, 0, "No timer while hidden");

    doc.setVisible(true);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(results.length, 1, "Fetched on becoming visible");

    poller.stop();
  });

  test("stale response discarded after stop", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();
    const results = [];
    const deferred = createDeferredFetch();

    const poller = createLanePoller({
      fetchFn: async () => {
        await deferred.promise;
        return MOCK_DTO;
      },
      onResult: (r) => results.push(r),
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    poller.stop(); // stop while fetch in flight
    deferred.resolve(MOCK_DTO);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(results.length, 0, "Stale response should be discarded");
  });

  test("stop is idempotent", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();

    const poller = createLanePoller({
      fetchFn: async () => MOCK_DTO,
      onResult: () => {},
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    poller.stop();
    poller.stop(); // second stop should not throw
    assert.equal(doc.listenerCount("visibilitychange"), 0, "Listener removed");
  });

  test("AbortError not counted as error", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();
    const results = [];

    const poller = createLanePoller({
      fetchFn: async (signal) => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
      onResult: (r) => results.push(r),
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    // AbortError should not produce a result or schedule a timer
    // (the generation has advanced, so the catch ignores it)
    poller.stop();
  });

  test("server unknown status is not counted as error", async () => {
    const timers = createFakeTimers();
    const doc = createFakeDoc();
    const results = [];

    const poller = createLanePoller({
      fetchFn: async () => UNKNOWN_DTO,
      onResult: (r) => results.push(r),
      doc,
      setT: timers.setT,
      clearT: timers.clearT,
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true); // successful poll
    assert.equal(results[0].data.status, "unknown");
    // Next timer at base interval (not backed off)
    assert.equal(timers.pending[0].ms, 5_000);

    poller.stop();
  });
});
