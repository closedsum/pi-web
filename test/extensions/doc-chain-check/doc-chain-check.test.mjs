import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const BLOCKED_EXTENSIONS = new Set([".ps1", ".sh", ".bash", ".bat", ".cmd"]);

const DOC_CHAIN_MAP = [
  { dir: "get-shit-done/hooks/", docFile: "HOOKS.md" },
  { dir: "get-shit-done/bin/ue/", docFile: "UE-SCRIPTS.md" },
];

function basename(filePath) {
  return filePath.split(/[/\\]/).pop();
}

function stem(filePath) {
  const base = basename(filePath);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function extension(filePath) {
  const base = basename(filePath);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function checkDocCoverage(changedFiles, docContents) {
  const missing = [];
  for (const file of changedFiles) {
    const rule = DOC_CHAIN_MAP.find((r) => file.startsWith(r.dir));
    if (!rule) continue;
    const base = basename(file);
    const s = stem(file);
    const content = docContents[rule.docFile] || "";
    if (!content.includes(base) && !content.includes(s)) {
      missing.push({ file, docFile: rule.docFile });
    }
  }
  return missing;
}

function checkScriptLanguage(addedFiles) {
  return addedFiles.filter((f) => BLOCKED_EXTENSIONS.has(extension(f)));
}

function handleToolCall(event, context = {}) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;

  const cmd = event.input?.command || "";
  const isCommit = /\bgit\s+commit\b/.test(cmd);
  const isPush = /\bgit\s+push\b/.test(cmd);
  if (!isCommit && !isPush) return undefined;

  if (isCommit) {
    const blocked = checkScriptLanguage(context.addedFiles || []);
    if (blocked.length > 0) {
      return {
        block: true,
        reason: `[SCRIPT-LANGUAGE] Blocked: non-Python scripts are not allowed: ${blocked.join(", ")}`,
      };
    }
  }

  const missing = checkDocCoverage(context.changedFiles || [], context.docContents || {});
  if (missing.length > 0) {
    return {
      advisory: true,
      message: `[DOC-CHAIN] Undocumented scripts: ${missing.map((m) => `${m.file} → ${m.docFile}`).join(", ")}`,
    };
  }

  return undefined;
}

test("ignores non-git commands", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("npm test")));
});

test("ignores git status/log/diff", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git status")));
  assertPassed(handleToolCall(makeBashToolCallEvent("git log")));
});

test("blocks .ps1 script on commit", () => {
  const ctx = { addedFiles: ["get-shit-done/bin/cleanup.ps1"] };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git commit -m 'add script'"), ctx),
    /SCRIPT-LANGUAGE/,
  );
});

test("blocks .sh script on commit", () => {
  const ctx = { addedFiles: ["scripts/deploy.sh"] };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git commit -m 'shell'"), ctx),
    /non-Python scripts/,
  );
});

test("blocks .bat script on commit", () => {
  const ctx = { addedFiles: ["run.bat"] };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git commit -m 'bat'"), ctx),
    /SCRIPT-LANGUAGE/,
  );
});

test("allows .py script on commit", () => {
  const ctx = { addedFiles: ["scripts/deploy.py"], changedFiles: [] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'py ok'"), ctx));
});

test("does NOT block script language on push", () => {
  const ctx = { addedFiles: ["scripts/deploy.sh"], changedFiles: [] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git push"), ctx));
});

test("advisory for undocumented hook", () => {
  const ctx = {
    changedFiles: ["get-shit-done/hooks/new-hook.cjs"],
    addedFiles: [],
    docContents: { "HOOKS.md": "existing-hook.cjs" },
  };
  const result = handleToolCall(makeBashToolCallEvent("git commit -m 'hook'"), ctx);
  assert.ok(result?.advisory);
  assert.match(result.message, /DOC-CHAIN/);
  assert.match(result.message, /new-hook\.cjs/);
});

test("no advisory when hook is documented", () => {
  const ctx = {
    changedFiles: ["get-shit-done/hooks/my-hook.cjs"],
    addedFiles: [],
    docContents: { "HOOKS.md": "my-hook.cjs is documented here" },
  };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'ok'"), ctx));
});

test("advisory for undocumented UE script", () => {
  const ctx = {
    changedFiles: ["get-shit-done/bin/ue/new_script.py"],
    addedFiles: [],
    docContents: { "UE-SCRIPTS.md": "old_script.py" },
  };
  const result = handleToolCall(makeBashToolCallEvent("git commit -m 'ue'"), ctx);
  assert.ok(result?.advisory);
  assert.match(result.message, /new_script/);
});

test("matches stem in doc content", () => {
  const ctx = {
    changedFiles: ["get-shit-done/hooks/my-hook.cjs"],
    addedFiles: [],
    docContents: { "HOOKS.md": "| my-hook |" },
  };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'stem ok'"), ctx));
});

test("script language check takes priority over doc coverage", () => {
  const ctx = {
    addedFiles: ["get-shit-done/hooks/bad.ps1"],
    changedFiles: ["get-shit-done/hooks/bad.ps1"],
    docContents: {},
  };
  const result = handleToolCall(makeBashToolCallEvent("git commit -m 'both'"), ctx);
  assert.ok(result?.block);
  assert.match(result.reason, /SCRIPT-LANGUAGE/);
});

test("works with PowerShell tool", () => {
  const ctx = { addedFiles: ["run.cmd"] };
  assertBlocked(
    handleToolCall(makePowerShellToolCallEvent("git commit -m 'cmd'"), ctx),
    /SCRIPT-LANGUAGE/,
  );
});

test("allows commit with no changed or added files", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'empty'"), {}));
});

test("files outside mapped dirs skip doc coverage", () => {
  const ctx = {
    changedFiles: ["src/main.ts"],
    addedFiles: [],
    docContents: {},
  };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'src'"), ctx));
});
