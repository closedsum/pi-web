import { execFileSync } from "child_process";

const GIT_TIMEOUT_MS = 5_000;
function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: "C" };
}

export function gitRevParseShowToplevel(cwd: string): string | null {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      env: gitEnv(),
    }).trim() || null;
  } catch {
    return null;
  }
}

export function gitLogLatestInScope(
  repo: string,
  branch: string,
  globs: string[],
): string | null {
  try {
    const args = ["-C", repo, "log", "-1", "--format=%aI", branch, "--", ...globs];
    const result = execFileSync("git", args, {
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      env: gitEnv(),
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}
