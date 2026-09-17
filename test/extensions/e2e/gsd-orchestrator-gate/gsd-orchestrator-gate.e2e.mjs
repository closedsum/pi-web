import assert from "node:assert/strict";
import test from "node:test";
import { E2E_CONFIG } from "../../_e2e-harness.mjs";

// Tests the CONSOLIDATED Pi extension logic (3 Claude hooks → 1 Pi handler)
// Source: ~/gsd-config/pi-config/extensions/gsd-orchestrator-gate.ts

const ALLOWED_GIT = new Set(["status", "log", "diff", "branch", "stash", "show"]);
const UE_ACTION_RE = /\bue_action\.py\b/i;
const CSMCP_HTTP_RE = /\bue_csmcp_http\.py\s+(?:catalog|call|console)\b/i;
const CSMCP_STATUS_RE = /\bue_csmcp_http\.py\s+status\b/i;
const LANE_DISPATCH_RE = /gsd_impl_lane\.py\s+(?:queue|build-queue|pipeline|status)\b/i;
const VERB_MANIFEST_FILES = new Set(["ue_action_verbs.json", "ue_verb_manifest.json", "ue_catalog_manifest.json"]);

function scrubGitMessages(cmd) { return cmd.replace(/-m\s+["'][^"']*["']/g, "-m ''"); }
function basename(p) { return (p || "").split(/[/\\]/).pop() || ""; }

function decide(toolName, input) {
  if (toolName === "Bash" || toolName === "PowerShell") {
    const cmd = input?.command || "";
    const git = /^\s*git\s+(\S+)/.exec(cmd);
    if (git && ALLOWED_GIT.has(git[1])) return null;
    if (LANE_DISPATCH_RE.test(cmd)) return null;
    if (/deploy\.py\s+--status/i.test(cmd)) return null;
    if (/^\s*(?:cat|head|tail|type)\s/i.test(cmd)) return null;
    if (/^\s*(?:Get-Process|tasklist)\b/i.test(cmd)) return null;
    if (/ue_csmcp_http\.py\s+status\b/i.test(cmd)) return null;
    const scrubbed = scrubGitMessages(cmd);
    if (UE_ACTION_RE.test(scrubbed)) return "ue_action.py blocked";
    if (CSMCP_HTTP_RE.test(scrubbed) && !CSMCP_STATUS_RE.test(scrubbed)) return "CsMCP blocked";
    return "orchestrator inline blocked";
  }
  if (toolName === "Read") {
    if (VERB_MANIFEST_FILES.has(basename(input?.file_path))) return "verb manifest blocked";
    if (/Content[/\\]Python[/\\]/.test(input?.file_path || "") && !/\.md$/i.test(input?.file_path || "")) return "catalog source blocked";
    return null;
  }
  if (toolName === "Glob") {
    if (/\.uasset|\.umap/i.test(input?.pattern || "")) return "asset glob blocked";
    if (/^Content\//i.test(input?.pattern || "") && !/\.md$/i.test(input?.pattern || "")) return "Content glob blocked";
    return null;
  }
  return null;
}

// Orchestrator-allowlist rules
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows git status`, () => { assert.equal(decide("Bash", { command: "git status" }), null); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows git log`, () => { assert.equal(decide("Bash", { command: "git log" }), null); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows lane dispatch`, () => { assert.equal(decide("Bash", { command: "python gsd_impl_lane.py queue --params x" }), null); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks pytest`, () => { assert.ok(decide("Bash", { command: "pytest tests/" })); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks npm test`, () => { assert.ok(decide("Bash", { command: "npm test" })); });

// Block-orchestrator-ue-planning rules
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks ue_action.py`, () => { assert.match(decide("Bash", { command: "python ue_action.py build" }), /ue_action/); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks CsMCP catalog`, () => { assert.match(decide("Bash", { command: "python ue_csmcp_http.py catalog" }), /CsMCP/); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows CsMCP status`, () => { assert.equal(decide("Bash", { command: "python ue_csmcp_http.py status" }), null); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks verb manifest Read`, () => { assert.ok(decide("Read", { file_path: "ue_action_verbs.json" })); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows README Read`, () => { assert.equal(decide("Read", { file_path: "README.md" }), null); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks .uasset Glob`, () => { assert.ok(decide("Glob", { pattern: "**/*.uasset" })); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows .md Content Glob`, () => { assert.equal(decide("Glob", { pattern: "Content/**/*.md" }), null); });

// Delegate-bounded-tasks rules
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows cat/head reads`, () => { assert.equal(decide("Bash", { command: "cat README.md" }), null); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows deploy --status`, () => { assert.equal(decide("Bash", { command: "python deploy.py --status" }), null); });
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows Get-Process`, () => { assert.equal(decide("PowerShell", { command: "Get-Process" }), null); });

// Git message scrubbing: ue_action in commit message should NOT trigger UE block
test(`[CONSOLIDATED ${E2E_CONFIG.model}] git commit with ue_action in message blocked as orchestrator, not UE`, () => {
  const reason = decide("Bash", { command: 'git commit -m "added ue_action.py"' });
  assert.ok(reason, "git commit should be blocked from orchestrator (lanes own commits)");
  assert.ok(!reason.includes("ue_action"), "should not blame ue_action.py — it's in the message, not the command");
});
