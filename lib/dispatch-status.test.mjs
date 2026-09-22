import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./dispatch-status.ts");
  } catch {
    return import("./dispatch-status.ts");
  }
}

describe("dispatch-status", () => {
  let tmpDir;
  let mod;

  beforeEach(async () => {
    mod = await loadSubject();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-status-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePipelineManifest(slug, overrides = {}) {
    const dir = path.join(tmpDir, ".planning", "impl-lanes");
    fs.mkdirSync(dir, { recursive: true });
    const data = {
      type: "pipeline",
      slug,
      title: `Task for ${slug}`,
      status: "running",
      phase: "impl",
      start: "2026-09-21T15:00:00+00:00",
      pid: 12345,
      rounds: [],
      ...overrides,
    };
    fs.writeFileSync(path.join(dir, `p-${slug}.json`), JSON.stringify(data));
  }

  function writeInitialParams(slug) {
    const dir = path.join(tmpDir, ".planning", "impl-lanes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `p-${slug}-params.json`),
      JSON.stringify({ Slug: slug, Task: 123, Repo: "/tmp", Title: "initial" }),
    );
  }

  function writeUeDispatch(data) {
    const dir = path.join(tmpDir, ".planning", "threads");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dispatch-progress.json"),
      JSON.stringify(data),
    );
  }

  describe("readAllDispatches", () => {
    it("returns empty array when no dispatch data exists", async () => {
      const result = await mod.readAllDispatches(tmpDir);
      assert.deepStrictEqual(result.dispatches, []);
    });

    it("reads pipeline manifest from impl-lanes", async () => {
      writePipelineManifest("fix-bug-abc123", {
        title: "Fix the bug",
        status: "running",
        phase: "impl",
        pid: 9999,
        start: "2026-09-21T19:00:00+00:00",
      });

      const result = await mod.readAllDispatches(tmpDir);
      assert.equal(result.dispatches.length, 1);

      const d = result.dispatches[0];
      assert.equal(d.id, "fix-bug-abc123");
      assert.equal(d.title, "Fix the bug");
      assert.equal(d.status, "running");
      assert.equal(d.phase, "impl");
      assert.equal(d.source, "lane");
      assert.equal(d.pid, 9999);
    });

    it("reads finished lane with end time and exit code", async () => {
      writePipelineManifest("done-xyz", {
        title: "Done task",
        status: "finished",
        phase: "terminal",
        start: "2026-09-21T18:00:00+00:00",
        end: "2026-09-21T18:10:00+00:00",
        exit_code: 0,
      });

      const result = await mod.readAllDispatches(tmpDir);
      const d = result.dispatches[0];
      assert.equal(d.status, "finished");
      assert.equal(d.finishedAt, "2026-09-21T18:10:00+00:00");
      assert.equal(d.displayCategory, "success");
    });

    it("maps status values to display categories", async () => {
      const cases = [
        { status: "starting", expected: "active" },
        { status: "running", expected: "active" },
        { status: "done", expected: "success" },
        { status: "finished", expected: "success" },
        { status: "integrated", expected: "success" },
        { status: "failed", expected: "failed" },
        { status: "review_failed", expected: "failed" },
        { status: "timed_out", expected: "failed" },
        { status: "orphaned", expected: "failed" },
        { status: "blocked", expected: "blocked" },
        { status: "cancelled", expected: "blocked" },
      ];
      for (const { status, expected } of cases) {
        writePipelineManifest(`cat-${status}`, { status, start: "2026-09-21T15:00:00+00:00" });
      }

      const result = await mod.readAllDispatches(tmpDir);
      for (const { status, expected } of cases) {
        const d = result.dispatches.find((x) => x.id === `cat-${status}`);
        assert.equal(d?.displayCategory, expected, `status "${status}" should map to "${expected}"`);
      }
    });

    it("reads failed lane with error message", async () => {
      writePipelineManifest("fail-abc", {
        status: "failed",
        phase: "init/worktree",
        _error: "OSError: path not found",
        exit_code: 1,
        end: "2026-09-21T18:05:00+00:00",
      });

      const result = await mod.readAllDispatches(tmpDir);
      const d = result.dispatches[0];
      assert.equal(d.status, "failed");
      assert.equal(d.phase, "init/worktree");
      assert.equal(d.error, "OSError: path not found");
    });

    it("ignores p-*-params.json (initial params, not manifests)", async () => {
      writeInitialParams("some-lane-abc");

      const result = await mod.readAllDispatches(tmpDir);
      assert.equal(result.dispatches.length, 0);
    });

    it("reads ue_dispatch progress from dispatch-progress.json", async () => {
      writeUeDispatch({
        id: "ue-dispatch",
        subject: "UE Dispatch · running",
        status: "running",
        steps: [
          { text: "open CropoutSampleProject", done: true },
          { text: "run PIE test", done: false },
        ],
        started_at: 1790017930.186,
      });

      const result = await mod.readAllDispatches(tmpDir);
      assert.equal(result.dispatches.length, 1);

      const d = result.dispatches[0];
      assert.equal(d.id, "ue-dispatch");
      assert.equal(d.source, "ue_dispatch");
      assert.equal(d.status, "running");
      assert.equal(d.steps.length, 2);
      assert.equal(d.steps[0].label, "open CropoutSampleProject");
      assert.equal(d.steps[0].done, true);
    });

    it("reads completed ue_dispatch with finished_at", async () => {
      writeUeDispatch({
        id: "ue-dispatch",
        subject: "UE Dispatch · completed",
        status: "completed",
        steps: [{ text: "open editor", done: true }],
        started_at: 1790017930.0,
        finished_at: 1790017940.0,
      });

      const result = await mod.readAllDispatches(tmpDir);
      const d = result.dispatches[0];
      assert.equal(d.status, "completed");
      assert.ok(d.finishedAt);
    });

    it("merges both lane and ue_dispatch sources", async () => {
      writePipelineManifest("lane-a-111", {
        title: "Lane A",
        start: "2026-09-21T19:05:00+00:00",
      });
      writeUeDispatch({
        id: "ue-dispatch",
        subject: "UE thing",
        status: "completed",
        steps: [],
        started_at: 1790017930.186,
        finished_at: 1790017940.0,
      });

      const result = await mod.readAllDispatches(tmpDir);
      assert.equal(result.dispatches.length, 2);
      const sources = result.dispatches.map((d) => d.source);
      assert.ok(sources.includes("lane"));
      assert.ok(sources.includes("ue_dispatch"));
    });

    it("sorts dispatches by startedAt descending (newest first)", async () => {
      writePipelineManifest("old-aaa", {
        title: "Old lane",
        status: "finished",
        start: "2026-09-21T17:00:00+00:00",
        end: "2026-09-21T17:10:00+00:00",
      });
      writePipelineManifest("new-bbb", {
        title: "New lane",
        status: "running",
        start: "2026-09-21T19:00:00+00:00",
      });

      const result = await mod.readAllDispatches(tmpDir);
      assert.equal(result.dispatches[0].id, "new-bbb");
      assert.equal(result.dispatches[1].id, "old-aaa");
    });

    it("reads events from events.jsonl for lane dispatches", async () => {
      writePipelineManifest("evented-aaa", {
        title: "Evented lane",
        start: "2026-09-21T19:00:00+00:00",
      });
      const eventsDir = path.join(tmpDir, ".planning", "impl-lanes", "evented-aaa");
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(path.join(eventsDir, "events.jsonl"), [
        JSON.stringify({ seq: 1, ts: "2026-09-21T19:00:01+00:00", type: "pipeline_start", phase: "init/starting" }),
        JSON.stringify({ seq: 2, ts: "2026-09-21T19:00:02+00:00", type: "preflight_pass", phase: "init/preflight" }),
        JSON.stringify({ seq: 3, ts: "2026-09-21T19:00:10+00:00", type: "worker_spawned", phase: "init/worker-spawn" }),
      ].join("\n") + "\n");

      const result = await mod.readAllDispatches(tmpDir);
      const d = result.dispatches[0];
      assert.ok(d.events, "must include events");
      assert.equal(d.events.length, 3);
      assert.equal(d.events[0].type, "pipeline_start");
      assert.equal(d.events[2].type, "worker_spawned");
    });

    it("returns empty events when events.jsonl does not exist", async () => {
      writePipelineManifest("no-events-bbb", {
        title: "No events lane",
        start: "2026-09-21T19:00:00+00:00",
      });

      const result = await mod.readAllDispatches(tmpDir);
      const d = result.dispatches[0];
      assert.ok(!d.events || d.events.length === 0, "events should be empty or undefined");
    });

    it("skips malformed files gracefully", async () => {
      const dir = path.join(tmpDir, ".planning", "impl-lanes");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "p-bad.json"), "not json{{{");

      writePipelineManifest("good-ccc", {
        title: "Good lane",
        start: "2026-09-21T19:00:00+00:00",
      });

      const result = await mod.readAllDispatches(tmpDir);
      assert.equal(result.dispatches.length, 1);
      assert.equal(result.dispatches[0].id, "good-ccc");
    });
  });

  describe("DispatchSection baseline exclusion logic", () => {
    it("pre-existing terminal lanes are excluded by baseline filter", async () => {
      writePipelineManifest("old-lane-aaa", { status: "failed", start: "2026-09-15T00:00:00+00:00" });
      writePipelineManifest("old-lane-bbb", { status: "done", start: "2026-09-15T01:00:00+00:00" });

      const result = await mod.readAllDispatches(tmpDir);
      const preExisting = new Set(result.dispatches.map(d => `${d.source}-${d.id}`));
      const visible = result.dispatches.filter(d => {
        const key = `${d.source}-${d.id}`;
        return d.displayCategory === "active" || !preExisting.has(key);
      });
      assert.equal(visible.length, 0, "all pre-existing terminal lanes excluded");
    });

    it("new lane added after baseline passes the filter", async () => {
      writePipelineManifest("old-lane-ccc", { status: "failed", start: "2026-09-15T00:00:00+00:00" });

      const result = await mod.readAllDispatches(tmpDir);
      const preExisting = new Set(result.dispatches.map(d => `${d.source}-${d.id}`));

      writePipelineManifest("new-lane-ddd", { status: "running", start: "2026-09-21T20:00:00+00:00" });
      const result2 = await mod.readAllDispatches(tmpDir);
      const visible = result2.dispatches.filter(d => {
        const key = `${d.source}-${d.id}`;
        return d.displayCategory === "active" || !preExisting.has(key);
      });
      assert.equal(visible.length, 1, "new lane passes filter");
      assert.equal(visible[0].id, "new-lane-ddd");
    });

    it("active lane always visible even if pre-existing", async () => {
      writePipelineManifest("zombie-lane", { status: "running", start: "2026-09-15T00:00:00+00:00" });

      const result = await mod.readAllDispatches(tmpDir);
      const preExisting = new Set(result.dispatches.map(d => `${d.source}-${d.id}`));
      const visible = result.dispatches.filter(d => {
        const key = `${d.source}-${d.id}`;
        return d.displayCategory === "active" || !preExisting.has(key);
      });
      assert.equal(visible.length, 1, "active zombie lane is visible");
      assert.equal(visible[0].id, "zombie-lane");
    });
  });
});
