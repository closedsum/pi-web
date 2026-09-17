import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const HARD_BLOCK_LINE_THRESHOLD = 200;

function parseGitCommand(cmd) {
  const trimmed = (cmd || "").trim();
  const match = /^\s*git\s+(\S+)/.exec(trimmed);
  if (!match) return null;
  return { subcommand: match[1], fullCommand: trimmed };
}

function isDocsOnly(files) {
  return files.length > 0 && files.every((f) => /\.md$/i.test(f));
}

function isLaneWorktree(context) {
  return !!(context && context.isLaneWorktree && context.hasPendingManifest);
}

function isRevertCommit(subject) {
  return /^Revert\s/i.test(subject || "");
}

function isMechanicalRefactor(subject) {
  return /^refactor\(lanes\):\s*extract\s+lane_/i.test(subject || "");
}

function commitIdentity(lineCount, patchSha) {
  return { lineCount, patchSha256: patchSha || null };
}

function hasReviewEvidence(patchSha, evidenceStore) {
  if (!evidenceStore || !patchSha) return false;
  return evidenceStore.has(patchSha);
}

function handleToolCall(event, context = {}) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;

  const cmd = event.input?.command || "";
  const parsed = parseGitCommand(cmd);
  if (!parsed) return undefined;

  const { subcommand } = parsed;
  if (subcommand !== "commit" && subcommand !== "push") return undefined;

  if (context.parseError) {
    return { block: true, reason: "[COMMIT-GATE] Command could not be parsed safely. Simplify and retry." };
  }

  const identity = context.identity || {};

  if (subcommand === "commit") {
    if (context.generatedOnly) return undefined;

    if (context.manifestCheckFailed) {
      return { block: true, reason: "[COMMIT-GATE] Generated catalog artifact failed manifest check. Regenerate before committing." };
    }

    if ((identity.lineCount || 0) < HARD_BLOCK_LINE_THRESHOLD) return undefined;

    if (isDocsOnly(context.changedFiles || [])) return undefined;

    if (isLaneWorktree(context)) return undefined;

    if (hasReviewEvidence(identity.patchSha256, context.evidenceStore)) return undefined;

    return {
      block: true,
      reason: `[COMMIT-GATE] ${identity.lineCount} lines changed (threshold: ${HARD_BLOCK_LINE_THRESHOLD}). No recent cross-review evidence found. Run /gsd:cross-review before committing.`,
    };
  }

  if (subcommand === "push") {
    const commits = context.commits || [];
    if (commits.length === 0) return undefined;

    const allExempt = commits.every((c) => {
      if (c.isMerge) return true;
      if (isRevertCommit(c.subject)) return true;
      if (isMechanicalRefactor(c.subject)) return true;
      if ((c.lineCount || 0) < HARD_BLOCK_LINE_THRESHOLD) return true;
      if (hasReviewEvidence(c.patchSha256, context.evidenceStore)) return true;
      return false;
    });

    if (allExempt) return undefined;

    const unreviewed = commits.filter(
      (c) =>
        !c.isMerge &&
        !isRevertCommit(c.subject) &&
        !isMechanicalRefactor(c.subject) &&
        (c.lineCount || 0) >= HARD_BLOCK_LINE_THRESHOLD &&
        !hasReviewEvidence(c.patchSha256, context.evidenceStore),
    );

    return {
      block: true,
      reason: `[COMMIT-GATE] Push blocked: ${unreviewed.length} commit(s) >= ${HARD_BLOCK_LINE_THRESHOLD} lines without review evidence.`,
    };
  }

  return undefined;
}

test("ignores non-git commands", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("npm test")));
});

test("ignores git status/log/diff", () => {
  assertPassed(handleToolCall(makeBashToolCallEvent("git status")));
  assertPassed(handleToolCall(makeBashToolCallEvent("git log --oneline")));
  assertPassed(handleToolCall(makeBashToolCallEvent("git diff HEAD")));
});

test("ignores non-Bash/PowerShell tools", () => {
  assertPassed(handleToolCall({ tool: "Edit", input: { command: "git commit -m 'x'" } }));
});

test("allows git commit under 200 lines", () => {
  const ctx = { identity: commitIdentity(150, "abc123"), changedFiles: ["src/main.ts"] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'small'"), ctx));
});

test("blocks git commit >= 200 lines without evidence", () => {
  const ctx = { identity: commitIdentity(250, "abc123"), changedFiles: ["src/main.ts"] };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git commit -m 'big'"), ctx),
    /250 lines changed.*threshold: 200/,
  );
});

test("allows git commit >= 200 lines with evidence", () => {
  const ctx = {
    identity: commitIdentity(300, "abc123"),
    changedFiles: ["src/main.ts"],
    evidenceStore: new Set(["abc123"]),
  };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'reviewed'"), ctx));
});

test("docs-only exemption for large commits", () => {
  const ctx = { identity: commitIdentity(500, "abc123"), changedFiles: ["README.md", "docs/guide.md"] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'docs'"), ctx));
});

test("lane worktree exemption for large commits", () => {
  const ctx = {
    identity: commitIdentity(400, "abc123"),
    changedFiles: ["src/main.ts"],
    isLaneWorktree: true,
    hasPendingManifest: true,
  };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'lane'"), ctx));
});

test("blocks on manifest check failure", () => {
  const ctx = { identity: commitIdentity(50, "abc"), manifestCheckFailed: true };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git commit -m 'bad manifest'"), ctx),
    /manifest check/,
  );
});

test("generated-only commit is exempt", () => {
  const ctx = { identity: commitIdentity(500, "abc"), generatedOnly: true };
  assertPassed(handleToolCall(makeBashToolCallEvent("git commit -m 'gen'"), ctx));
});

test("blocks on parse error", () => {
  const ctx = { parseError: true };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git commit -m 'complex'"), ctx),
    /could not be parsed/,
  );
});

test("allows push with all merge commits", () => {
  const ctx = { commits: [{ isMerge: true }, { isMerge: true }] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git push"), ctx));
});

test("allows push with Revert commits", () => {
  const ctx = { commits: [{ subject: "Revert bad change", lineCount: 500 }] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git push"), ctx));
});

test("allows push with mechanical refactor", () => {
  const ctx = { commits: [{ subject: "refactor(lanes): extract lane_pipeline module", lineCount: 400 }] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git push"), ctx));
});

test("allows push with small commits", () => {
  const ctx = { commits: [{ subject: "fix typo", lineCount: 10 }] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git push"), ctx));
});

test("blocks push with large unreviewed commits", () => {
  const ctx = {
    commits: [
      { subject: "big feature", lineCount: 300, patchSha256: "def456" },
    ],
  };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git push"), ctx),
    /Push blocked.*1 commit/,
  );
});

test("allows push with large reviewed commits", () => {
  const ctx = {
    commits: [{ subject: "reviewed feature", lineCount: 300, patchSha256: "def456" }],
    evidenceStore: new Set(["def456"]),
  };
  assertPassed(handleToolCall(makeBashToolCallEvent("git push"), ctx));
});

test("blocks push with mixed reviewed and unreviewed", () => {
  const ctx = {
    commits: [
      { subject: "reviewed", lineCount: 300, patchSha256: "aaa" },
      { subject: "unreviewed", lineCount: 250, patchSha256: "bbb" },
    ],
    evidenceStore: new Set(["aaa"]),
  };
  assertBlocked(
    handleToolCall(makeBashToolCallEvent("git push"), ctx),
    /Push blocked.*1 commit/,
  );
});

test("allows empty push (no commits)", () => {
  const ctx = { commits: [] };
  assertPassed(handleToolCall(makeBashToolCallEvent("git push"), ctx));
});

test("works with PowerShell tool", () => {
  const ctx = { identity: commitIdentity(250, "xyz"), changedFiles: ["src/main.ts"] };
  assertBlocked(
    handleToolCall(makePowerShellToolCallEvent("git commit -m 'big'"), ctx),
    /250 lines/,
  );
});

test("commit block message includes remediation", () => {
  const ctx = { identity: commitIdentity(200, "abc"), changedFiles: ["src/x.ts"] };
  const result = handleToolCall(makeBashToolCallEvent("git commit -m 'exact threshold'"), ctx);
  assert.ok(result?.block);
  assert.match(result.reason, /cross-review/i);
});

test("docs-only check requires all files to be .md", () => {
  const ctx = { identity: commitIdentity(300, "abc"), changedFiles: ["README.md", "src/main.ts"] };
  assertBlocked(handleToolCall(makeBashToolCallEvent("git commit -m 'mixed'"), ctx), /300 lines/);
});
