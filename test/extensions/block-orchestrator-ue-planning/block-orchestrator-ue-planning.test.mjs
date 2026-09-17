import assert from "node:assert/strict";
import test from "node:test";
import {
  makeBashToolCallEvent, makePowerShellToolCallEvent,
  makeReadToolCallEvent, assertBlocked, assertPassed,
} from "../_config.mjs";

const UE_ACTION_RE = /\bue_action\.py\b/i;
const CSMCP_HTTP_RE = /\bue_csmcp_http\.py\s+(?:catalog|call|console)\b/i;
const CSMCP_STATUS_RE = /\bue_csmcp_http\.py\s+status\b/i;
const CSMCP_PROBE_RE = /\/csmcp\/catalog|CsMCP\.catalog/i;
const VERB_MANIFEST_FILES = new Set(["ue_action_verbs.json", "ue_verb_manifest.json", "ue_catalog_manifest.json"]);

function basename(filePath) {
  return (filePath || "").split(/[/\\]/).pop();
}

function isSubagent(event) {
  return !!(event.agent_id || event.agent_type);
}

function scrubGitMessages(cmd) {
  return cmd.replace(/-m\s+["'][^"']*["']/g, "-m ''").replace(/-m\s+\S+/g, "-m ''");
}

function handleToolCall(event) {
  if (isSubagent(event)) return undefined;

  const tool = event.tool;
  const input = event.input || {};

  if (tool === "Bash" || tool === "PowerShell") {
    const raw = input.command || "";
    const cmd = scrubGitMessages(raw);

    if (UE_ACTION_RE.test(cmd)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: ue_action.py must be dispatched through ue_ops_dispatch.py, not called directly." };
    }
    if (CSMCP_HTTP_RE.test(cmd) && !CSMCP_STATUS_RE.test(cmd)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: CsMCP HTTP planning must go through ue_ops_dispatch.py." };
    }
    if (CSMCP_PROBE_RE.test(cmd)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: CsMCP catalog probe must go through ue_ops_dispatch.py." };
    }
    return undefined;
  }

  if (tool === "Read") {
    const filePath = input.file_path || "";
    const base = basename(filePath);
    if (VERB_MANIFEST_FILES.has(base)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: reading verb/catalog manifest directly. Use ue_ops_dispatch.py." };
    }
    if (/Content[/\\]Python[/\\]/.test(filePath) && !/\.md$/i.test(filePath)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: reading catalog Python source. Use ue-ops agent." };
    }
    return undefined;
  }

  if (tool === "Grep") {
    const pattern = input.pattern || "";
    const path = input.path || "";
    if (/CATALOG_GROUP/i.test(pattern)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: searching CATALOG_GROUP registrations. Use ue-ops agent." };
    }
    if (/Content[/\\]Python/i.test(path) && !/\.md$/i.test(input.glob || "")) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: searching Content/Python sources. Use ue-ops agent." };
    }
    return undefined;
  }

  if (tool === "Glob") {
    const pattern = input.pattern || "";
    if (/\.uasset|\.umap/i.test(pattern)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: globbing asset files. Use ue-ops agent." };
    }
    if (/^Content\//i.test(pattern) && !/\.md$/i.test(pattern)) {
      return { block: true, reason: "[ORCHESTRATOR-UE-PLANNING] BLOCKED: globbing Content/ directory. Use ue-ops agent." };
    }
    return undefined;
  }

  return undefined;
}

test("blocks ue_action.py from orchestrator", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent("python ue_action.py build")), /ue_action\.py/);
});

test("blocks ue_action.py with interpreter flags", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent("python -u -X utf8 ue_action.py launch")), /ue_action\.py/);
});

test("allows ue_action.py from subagent", () => {
  const event = { ...makeBashToolCallEvent("python ue_action.py build"), agent_id: "fork-1" };
  assertPassed(handleToolCall(event));
});

test("allows ue_action.py from ue-ops agent", () => {
  const event = { ...makeBashToolCallEvent("python ue_action.py launch"), agent_type: "ue-ops" };
  assertPassed(handleToolCall(event));
});

test("blocks CsMCP catalog call", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent("python ue_csmcp_http.py catalog")), /CsMCP HTTP/);
});

test("blocks CsMCP console call", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent("python ue_csmcp_http.py console")), /CsMCP HTTP/);
});

test("allows CsMCP status call", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("python ue_csmcp_http.py status")));
});

test("blocks /csmcp/catalog probe", () => {
  assertBlocked(handleToolCall(makeBashToolCallEvent("curl /csmcp/catalog")), /catalog probe/);
});

test("blocks reading verb manifest", () => {
  assertBlocked(handleToolCall(makeReadToolCallEvent("bin/ue/ue_action_verbs.json")), /verb.*manifest/);
});

test("blocks reading catalog manifest", () => {
  assertBlocked(handleToolCall(makeReadToolCallEvent("bin/ue/ue_catalog_manifest.json")), /verb.*manifest/);
});

test("blocks reading Content/Python source", () => {
  assertBlocked(
    handleToolCall(makeReadToolCallEvent("Content/Python/csmcp_catalog.py")),
    /catalog Python source/,
  );
});

test("allows reading Content/Python .md files", () => {
  assertPassed(handleToolCall(makeReadToolCallEvent("Content/Python/README.md")));
});

test("blocks Grep for CATALOG_GROUP", () => {
  const event = { tool: "Grep", input: { pattern: "CATALOG_GROUP", path: "." } };
  assertBlocked(handleToolCall(event), /CATALOG_GROUP/);
});

test("blocks Grep scoped to Content/Python", () => {
  const event = { tool: "Grep", input: { pattern: "def register", path: "Content/Python/" } };
  assertBlocked(handleToolCall(event), /Content\/Python/);
});

test("allows Grep scoped to Content/Python with .md glob", () => {
  const event = { tool: "Grep", input: { pattern: "def register", path: "Content/Python/", glob: "*.md" } };
  assertPassed(handleToolCall(event));
});

test("blocks Glob for .uasset files", () => {
  const event = { tool: "Glob", input: { pattern: "**/*.uasset" } };
  assertBlocked(handleToolCall(event), /asset files/);
});

test("blocks Glob for Content/ non-md", () => {
  const event = { tool: "Glob", input: { pattern: "Content/**/*.py" } };
  assertBlocked(handleToolCall(event), /Content/);
});

test("allows Glob for Content/ .md files", () => {
  const event = { tool: "Glob", input: { pattern: "Content/**/*.md" } };
  assertPassed(handleToolCall(event));
});

test("scrubs git commit messages", () => {
  const cmd = 'git commit -m "python ue_action.py build" && git push';
  const scrubbed = scrubGitMessages(cmd);
  assert.ok(!scrubbed.includes("ue_action.py"));
});

test("allows git commit mentioning ue_action in message", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent('git commit -m "added ue_action.py call"')));
});

test("ignores unrelated tools", () => {
  assertPassed(handleToolCall({ tool: "Edit", input: { file_path: "ue_action.py" } }));
});

test("works with PowerShell tool", () => {
  assertBlocked(
    handleToolCall(makePowerShellToolCallEvent("python ue_action.py build")),
    /ue_action\.py/,
  );
});
