import { readFileSync } from "fs";
import path from "path";
import { parseNamedArg } from "../shell-command-parser";
import { gitLogLatestInScope } from "../git-query";
import { commandStr } from "./tool-blockers";
import type { BlockResult } from "./types";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const PIPELINE_RE = /gsd_impl_lane\.py\s+pipeline\b/;
const FAILURE_STATUSES = new Set(["failed", "blocked", "review_failed"]);

type GitChecker = (repo: string, branch: string, globs: string[]) => string | null;

export function checkRedispatchWithoutFix(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  gitCheck: GitChecker = gitLogLatestInScope,
): BlockResult | undefined {
  if (!SHELL_TOOLS.has(toolName)) return undefined;

  const cmd = commandStr(input);
  if (!PIPELINE_RE.test(cmd)) return undefined;

  const paramsFile = parseNamedArg(cmd, "--params-file");
  if (!paramsFile) return undefined;

  let params: { slug?: string; write_scope?: string[] };
  try {
    params = JSON.parse(readFileSync(paramsFile, "utf-8"));
  } catch {
    return undefined;
  }

  const slug = params.slug;
  if (!slug) return undefined;

  const manifestPath = path.join(cwd, ".planning", "impl-lanes", `p-${slug}.json`);
  let manifest: { status?: string; updated_at?: string };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return undefined;
  }

  if (!manifest.status || !FAILURE_STATUSES.has(manifest.status)) {
    return undefined;
  }

  const writeScope = params.write_scope ?? [];
  if (writeScope.length > 0) {
    const latestCommit = gitCheck(cwd, "master", writeScope);
    if (latestCommit !== null) {
      return undefined;
    }
  }

  return {
    block: true,
    reason: `Pipeline "${slug}" previously ${manifest.status}; fix root cause and commit within WriteScope before redispatch.`,
  };
}
