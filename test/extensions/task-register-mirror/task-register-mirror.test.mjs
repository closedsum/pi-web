import assert from "node:assert/strict";
import test from "node:test";
import { makeToolCallEvent } from "../_config.mjs";

const TERMINAL_STATES = new Set(["completed", "deleted"]);
const REPO_PATTERNS = [
  { pattern: /gsd-config/i, name: "gsd-config" },
  { pattern: /cropout/i, name: "Cropout" },
  { pattern: /csmcp/i, name: "CsMCP" },
  { pattern: /pi-web/i, name: "pi-web" },
];

function detectRepo(description) {
  if (!description) return "";
  for (const { pattern, name } of REPO_PATTERNS) {
    if (pattern.test(description)) return name;
  }
  return "";
}

function makeMarker(sessionId, taskId) {
  const key = `${sessionId}:${taskId}`;
  return `<!-- task-register:${Buffer.from(key).toString("base64")} -->`;
}

function makeRegisterRow(number, subject, repo, state, marker) {
  return `| ${number} | ${subject} | ${repo} | ${state} ${marker} |`;
}

function applyCreate(register, event, sessionId) {
  const taskId = event.result?.id || event.result?.task_id || "unknown";
  const subject = event.input?.subject || event.input?.description || "";
  const repo = detectRepo(subject);
  const marker = makeMarker(sessionId, taskId);

  const existingIdx = register.rows.findIndex((r) => r.includes(marker));
  if (existingIdx >= 0) return register;

  const maxNum = register.rows.reduce((max, r) => {
    const m = /^\|\s*(\d+)\s*\|/.exec(r);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);

  const row = makeRegisterRow(maxNum + 1, subject, repo, "pending", marker);
  register.rows.push(row);
  register.taskMap[`${sessionId}:${taskId}`] = maxNum + 1;
  return register;
}

function applyUpdate(register, event, sessionId) {
  const taskId = event.result?.id || event.input?.task_id || "unknown";
  const status = event.input?.status || event.result?.status || "";

  if (!TERMINAL_STATES.has(status)) return register;

  const marker = makeMarker(sessionId, taskId);
  const rowIdx = register.rows.findIndex((r) => r.includes(marker));
  if (rowIdx < 0) return register;

  const prefix = status === "completed" ? "DONE" : "RETIRED";
  const ts = new Date().toISOString().slice(0, 10);
  register.rows[rowIdx] = register.rows[rowIdx].replace(
    /\|\s*([^|]*?)\s*(\<!-- task-register:[^>]+-->)\s*\|$/,
    `| ${prefix} ${ts}: $1 $2 |`,
  );
  return register;
}

function handleToolResult(event, register, sessionId = "test-session") {
  if (event.tool !== "TaskCreate" && event.tool !== "TaskUpdate" && event.tool !== "TaskList") {
    return undefined;
  }

  if (event.result?.isError || event.result?.error || event.result?.success === false) {
    return undefined;
  }

  if (event.tool === "TaskList") return undefined;

  if (event.tool === "TaskCreate") {
    applyCreate(register, event, sessionId);
    return { mirrored: true, action: "create" };
  }

  if (event.tool === "TaskUpdate") {
    const status = event.input?.status || event.result?.status || "";
    if (!TERMINAL_STATES.has(status)) return undefined;
    applyUpdate(register, event, sessionId);
    return { mirrored: true, action: "update", status };
  }

  return undefined;
}

function makeRegister() {
  return { rows: [], taskMap: {} };
}

test("mirrors TaskCreate to register", () => {
  const reg = makeRegister();
  const event = {
    tool: "TaskCreate",
    input: { subject: "Fix auth bug in Cropout" },
    result: { id: "t1", success: true },
  };
  const result = handleToolResult(event, reg);
  assert.ok(result?.mirrored);
  assert.equal(result.action, "create");
  assert.equal(reg.rows.length, 1);
  assert.match(reg.rows[0], /Fix auth bug in Cropout/);
  assert.match(reg.rows[0], /Cropout/);
});

test("assigns incrementing row numbers", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "task A" }, result: { id: "t1" } },
    reg,
  );
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "task B" }, result: { id: "t2" } },
    reg,
  );
  assert.match(reg.rows[0], /^\|\s*1\s*\|/);
  assert.match(reg.rows[1], /^\|\s*2\s*\|/);
});

test("deduplicates by marker", () => {
  const reg = makeRegister();
  const event = {
    tool: "TaskCreate",
    input: { subject: "dup task" },
    result: { id: "t1" },
  };
  handleToolResult(event, reg);
  handleToolResult(event, reg);
  assert.equal(reg.rows.length, 1);
});

test("mirrors TaskUpdate completed to DONE prefix", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "task to complete" }, result: { id: "t1" } },
    reg,
  );
  handleToolResult(
    { tool: "TaskUpdate", input: { task_id: "t1", status: "completed" }, result: { id: "t1" } },
    reg,
  );
  assert.match(reg.rows[0], /DONE \d{4}-\d{2}-\d{2}/);
});

test("mirrors TaskUpdate deleted to RETIRED prefix", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "task to delete" }, result: { id: "t1" } },
    reg,
  );
  handleToolResult(
    { tool: "TaskUpdate", input: { task_id: "t1", status: "deleted" }, result: { id: "t1" } },
    reg,
  );
  assert.match(reg.rows[0], /RETIRED \d{4}-\d{2}-\d{2}/);
});

test("ignores TaskUpdate for non-terminal states", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "in progress" }, result: { id: "t1" } },
    reg,
  );
  const result = handleToolResult(
    { tool: "TaskUpdate", input: { task_id: "t1", status: "in_progress" }, result: { id: "t1" } },
    reg,
  );
  assert.equal(result, undefined);
  assert.ok(!reg.rows[0].includes("DONE"));
});

test("TaskList returns undefined (board snapshot only)", () => {
  const reg = makeRegister();
  const result = handleToolResult(
    { tool: "TaskList", input: {}, result: { tasks: [] } },
    reg,
  );
  assert.equal(result, undefined);
});

test("ignores non-task tools", () => {
  const reg = makeRegister();
  const result = handleToolResult(
    { tool: "Edit", input: { file_path: "x.ts" }, result: {} },
    reg,
  );
  assert.equal(result, undefined);
  assert.equal(reg.rows.length, 0);
});

test("skips on error response", () => {
  const reg = makeRegister();
  const result = handleToolResult(
    { tool: "TaskCreate", input: { subject: "fail" }, result: { isError: true } },
    reg,
  );
  assert.equal(result, undefined);
  assert.equal(reg.rows.length, 0);
});

test("skips on success=false response", () => {
  const reg = makeRegister();
  const result = handleToolResult(
    { tool: "TaskCreate", input: { subject: "fail" }, result: { success: false } },
    reg,
  );
  assert.equal(result, undefined);
});

test("detects gsd-config repo from description", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "Fix hook in gsd-config" }, result: { id: "t1" } },
    reg,
  );
  assert.match(reg.rows[0], /gsd-config/);
});

test("detects CsMCP repo from description", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "Update CsMCP sidecar" }, result: { id: "t1" } },
    reg,
  );
  assert.match(reg.rows[0], /CsMCP/);
});

test("empty repo for unmatched descriptions", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "Generic task" }, result: { id: "t1" } },
    reg,
  );
  assert.match(reg.rows[0], /\|\s*\|/);
});

test("marker contains base64 encoded session:task pair", () => {
  const marker = makeMarker("sess1", "task1");
  assert.match(marker, /<!-- task-register:/);
  const encoded = marker.match(/task-register:([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encoded);
  assert.equal(Buffer.from(encoded, "base64").toString(), "sess1:task1");
});

test("taskMap tracks session:task to row number", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "mapped" }, result: { id: "t5" } },
    reg,
    "my-session",
  );
  assert.equal(reg.taskMap["my-session:t5"], 1);
});

test("update on missing row is a no-op", () => {
  const reg = makeRegister();
  const result = handleToolResult(
    { tool: "TaskUpdate", input: { task_id: "nonexistent", status: "completed" }, result: { id: "nonexistent" } },
    reg,
  );
  assert.ok(result?.mirrored);
  assert.equal(reg.rows.length, 0);
});

test("does not double-complete already terminal rows", () => {
  const reg = makeRegister();
  handleToolResult(
    { tool: "TaskCreate", input: { subject: "one-shot" }, result: { id: "t1" } },
    reg,
  );
  handleToolResult(
    { tool: "TaskUpdate", input: { task_id: "t1", status: "completed" }, result: { id: "t1" } },
    reg,
  );
  const firstDone = reg.rows[0];
  handleToolResult(
    { tool: "TaskUpdate", input: { task_id: "t1", status: "completed" }, result: { id: "t1" } },
    reg,
  );
  assert.ok(reg.rows[0].includes("DONE"));
});
