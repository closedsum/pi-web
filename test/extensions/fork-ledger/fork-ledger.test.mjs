import assert from "node:assert/strict";
import test from "node:test";
import { makeAgentToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const MAX_FORKS_DEFAULT = 4;
const FORK_TTL_MS = 5 * 60 * 1000;
const WORKTREE_TTL_MS = 60 * 60 * 1000;
const ORPHAN_AGE_MS = 15_000;

function sha256(str) {
  return `sha256_${str.slice(0, 16)}`;
}

function makeLedger(entries = []) {
  return { entries: [...entries] };
}

function liveDispatches(ledger, now = Date.now()) {
  const completed = new Set();
  for (const e of ledger.entries) {
    if (e.status === "completed" || e.status === "failed") {
      completed.add(e.token);
    }
  }
  return ledger.entries.filter((e) => {
    if (e.status !== "dispatched") return false;
    if (completed.has(e.token)) return false;
    const age = now - e.ts;
    const ttl = e.isolation === "worktree" ? WORKTREE_TTL_MS : FORK_TTL_MS;
    if (age > ttl) return false;
    return true;
  });
}

function handlePreToolUse(event, ledger, config = {}) {
  if (event.tool !== "Agent") return undefined;

  const maxForks = config.max_forks || MAX_FORKS_DEFAULT;
  const now = Date.now();
  const live = liveDispatches(ledger, now);

  if (live.length >= maxForks) {
    return {
      block: true,
      reason: `[FORK-LEDGER] Cap reached: ${live.length}/${maxForks} live dispatches. Wait for completions before dispatching more.`,
    };
  }

  const token = `tok_${Math.random().toString(36).slice(2, 10)}`;
  const promptHash = sha256(event.input?.prompt || "");
  const isolation = event.input?.isolation || "none";

  ledger.entries.push({
    token,
    ts: now,
    status: "dispatched",
    prompt_sha256: promptHash,
    isolation,
    subagent_type: event.input?.subagent_type || "fork",
    description: (event.input?.prompt || "").slice(0, 120),
  });

  return undefined;
}

function handlePostToolUse(event, ledger) {
  if (event.tool !== "Agent") return undefined;

  const promptHash = sha256(event.input?.prompt || "");
  const match = [...ledger.entries].reverse().find(
    (e) => e.status === "dispatched" && e.prompt_sha256 === promptHash,
  );
  if (!match) return undefined;

  const isError =
    event.result?.isError || event.result?.error || event.result?.success === false;

  ledger.entries.push({
    token: match.token,
    ts: Date.now(),
    status: isError ? "failed" : "completed",
    duration_seconds: (Date.now() - match.ts) / 1000,
  });

  return undefined;
}

function cleanOrphans(pendingMarkers, ledger, now = Date.now()) {
  const expired = pendingMarkers.filter((m) => now - m.ts > ORPHAN_AGE_MS);
  for (const m of expired) {
    ledger.entries.push({ token: m.token, ts: now, status: "failed" });
  }
  return expired.map((m) => m.token);
}

test("allows Agent call when under cap", () => {
  const ledger = makeLedger();
  assertPassed(handlePreToolUse(makeAgentToolCallEvent("do work"), ledger));
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].status, "dispatched");
});

test("blocks Agent call when at cap", () => {
  const now = Date.now();
  const ledger = makeLedger([
    { token: "a", ts: now, status: "dispatched", isolation: "none" },
    { token: "b", ts: now, status: "dispatched", isolation: "none" },
    { token: "c", ts: now, status: "dispatched", isolation: "none" },
    { token: "d", ts: now, status: "dispatched", isolation: "none" },
  ]);
  assertBlocked(
    handlePreToolUse(makeAgentToolCallEvent("do more"), ledger),
    /Cap reached.*4\/4/,
  );
});

test("blocks Agent call when over cap", () => {
  const now = Date.now();
  const ledger = makeLedger([
    { token: "a", ts: now, status: "dispatched", isolation: "none" },
    { token: "b", ts: now, status: "dispatched", isolation: "none" },
    { token: "c", ts: now, status: "dispatched", isolation: "none" },
    { token: "d", ts: now, status: "dispatched", isolation: "none" },
    { token: "e", ts: now, status: "dispatched", isolation: "none" },
  ]);
  assertBlocked(
    handlePreToolUse(makeAgentToolCallEvent("do more"), ledger),
    /Cap reached.*5\/4/,
  );
});

test("completed dispatches free slots", () => {
  const now = Date.now();
  const ledger = makeLedger([
    { token: "a", ts: now, status: "dispatched", isolation: "none" },
    { token: "b", ts: now, status: "dispatched", isolation: "none" },
    { token: "c", ts: now, status: "dispatched", isolation: "none" },
    { token: "d", ts: now, status: "dispatched", isolation: "none" },
    { token: "a", ts: now, status: "completed" },
  ]);
  assertPassed(handlePreToolUse(makeAgentToolCallEvent("slot freed"), ledger));
});

test("failed dispatches free slots", () => {
  const now = Date.now();
  const ledger = makeLedger([
    { token: "a", ts: now, status: "dispatched", isolation: "none" },
    { token: "b", ts: now, status: "dispatched", isolation: "none" },
    { token: "c", ts: now, status: "dispatched", isolation: "none" },
    { token: "d", ts: now, status: "dispatched", isolation: "none" },
    { token: "b", ts: now, status: "failed" },
  ]);
  assertPassed(handlePreToolUse(makeAgentToolCallEvent("slot freed"), ledger));
});

test("TTL expiry frees fork slots after 5 min", () => {
  const now = Date.now();
  const oldTs = now - FORK_TTL_MS - 1000;
  const ledger = makeLedger([
    { token: "a", ts: oldTs, status: "dispatched", isolation: "none" },
    { token: "b", ts: oldTs, status: "dispatched", isolation: "none" },
    { token: "c", ts: oldTs, status: "dispatched", isolation: "none" },
    { token: "d", ts: oldTs, status: "dispatched", isolation: "none" },
  ]);
  assertPassed(handlePreToolUse(makeAgentToolCallEvent("all expired"), ledger));
});

test("worktree dispatches get 60 min TTL", () => {
  const now = Date.now();
  const ts30min = now - 30 * 60 * 1000;
  const ledger = makeLedger([
    { token: "a", ts: ts30min, status: "dispatched", isolation: "worktree" },
    { token: "b", ts: ts30min, status: "dispatched", isolation: "worktree" },
    { token: "c", ts: ts30min, status: "dispatched", isolation: "worktree" },
    { token: "d", ts: ts30min, status: "dispatched", isolation: "worktree" },
  ]);
  assertBlocked(
    handlePreToolUse(makeAgentToolCallEvent("still live"), ledger),
    /Cap reached/,
  );
});

test("worktree dispatches expire after 60 min", () => {
  const now = Date.now();
  const oldTs = now - WORKTREE_TTL_MS - 1000;
  const ledger = makeLedger([
    { token: "a", ts: oldTs, status: "dispatched", isolation: "worktree" },
    { token: "b", ts: oldTs, status: "dispatched", isolation: "worktree" },
    { token: "c", ts: oldTs, status: "dispatched", isolation: "worktree" },
    { token: "d", ts: oldTs, status: "dispatched", isolation: "worktree" },
  ]);
  assertPassed(handlePreToolUse(makeAgentToolCallEvent("all expired"), ledger));
});

test("non-Agent tools pass through on PreToolUse", () => {
  const ledger = makeLedger();
  assertPassed(handlePreToolUse({ tool: "Bash", input: {} }, ledger));
  assert.equal(ledger.entries.length, 0);
});

test("configurable max_forks", () => {
  const now = Date.now();
  const ledger = makeLedger([
    { token: "a", ts: now, status: "dispatched", isolation: "none" },
    { token: "b", ts: now, status: "dispatched", isolation: "none" },
  ]);
  assertBlocked(
    handlePreToolUse(makeAgentToolCallEvent("cap 2"), ledger, { max_forks: 2 }),
    /Cap reached.*2\/2/,
  );
});

test("PostToolUse records completion", () => {
  const ledger = makeLedger();
  handlePreToolUse(makeAgentToolCallEvent("task A"), ledger);
  assert.equal(ledger.entries.length, 1);

  handlePostToolUse(
    { tool: "Agent", input: { prompt: "task A" }, result: { success: true } },
    ledger,
  );
  assert.equal(ledger.entries.length, 2);
  assert.equal(ledger.entries[1].status, "completed");
});

test("PostToolUse records failure on isError", () => {
  const ledger = makeLedger();
  handlePreToolUse(makeAgentToolCallEvent("task B"), ledger);

  handlePostToolUse(
    { tool: "Agent", input: { prompt: "task B" }, result: { isError: true } },
    ledger,
  );
  assert.equal(ledger.entries[1].status, "failed");
});

test("PostToolUse records failure on error field", () => {
  const ledger = makeLedger();
  handlePreToolUse(makeAgentToolCallEvent("task C"), ledger);

  handlePostToolUse(
    { tool: "Agent", input: { prompt: "task C" }, result: { error: "boom" } },
    ledger,
  );
  assert.equal(ledger.entries[1].status, "failed");
});

test("PostToolUse ignores non-Agent tools", () => {
  const ledger = makeLedger();
  handlePostToolUse({ tool: "Bash", input: {}, result: {} }, ledger);
  assert.equal(ledger.entries.length, 0);
});

test("orphan cleanup expires stale pending markers", () => {
  const now = Date.now();
  const ledger = makeLedger();
  const pending = [
    { token: "orphan1", ts: now - ORPHAN_AGE_MS - 1000 },
    { token: "fresh1", ts: now - 5000 },
  ];
  const cleaned = cleanOrphans(pending, ledger, now);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0], "orphan1");
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].status, "failed");
});

test("dispatch records prompt_sha256 and isolation", () => {
  const ledger = makeLedger();
  const event = makeAgentToolCallEvent("my prompt");
  event.input.isolation = "worktree";
  handlePreToolUse(event, ledger);
  assert.ok(ledger.entries[0].prompt_sha256);
  assert.equal(ledger.entries[0].isolation, "worktree");
  assert.equal(ledger.entries[0].subagent_type, "fork");
});

test("mixed live and completed dispatches counted correctly", () => {
  const now = Date.now();
  const ledger = makeLedger([
    { token: "a", ts: now, status: "dispatched", isolation: "none" },
    { token: "b", ts: now, status: "dispatched", isolation: "none" },
    { token: "a", ts: now, status: "completed" },
    { token: "c", ts: now, status: "dispatched", isolation: "none" },
    { token: "d", ts: now, status: "dispatched", isolation: "none" },
    { token: "e", ts: now, status: "dispatched", isolation: "none" },
  ]);
  const live = liveDispatches(ledger, now);
  assert.equal(live.length, 4);
});

test("empty ledger allows dispatch", () => {
  const ledger = makeLedger();
  assertPassed(handlePreToolUse(makeAgentToolCallEvent("first"), ledger));
  assert.equal(ledger.entries.length, 1);
});
