import { execFileSync, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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

export interface AsyncGitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AsyncGitContext {
  latestInScope: string | null;
  toplevel: string | null;
}

export async function gitRevParseShowToplevelAsync(
  cwd: string,
  options?: AsyncGitOptions,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      {
        timeout: options?.timeoutMs ?? GIT_TIMEOUT_MS,
        encoding: "utf8",
        env: gitEnv(),
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        signal: options?.signal,
      },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function gitLogLatestInScopeAsync(
  repo: string,
  branch: string,
  globs: string[],
  options?: AsyncGitOptions,
): Promise<string | null> {
  try {
    const args = ["-C", repo, "log", "-1", "--format=%aI", branch, "--", ...globs];
    const { stdout } = await execFileAsync("git", args, {
      timeout: options?.timeoutMs ?? GIT_TIMEOUT_MS,
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      signal: options?.signal,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function prefetchGitFacts(
  cwd: string,
  branch: string,
  globs: string[],
  options?: AsyncGitOptions,
): Promise<AsyncGitContext> {
  const [latestInScope, toplevel] = await Promise.all([
    gitLogLatestInScopeAsync(cwd, branch, globs, options),
    gitRevParseShowToplevelAsync(cwd, options),
  ]);
  return Object.freeze({ latestInScope, toplevel });
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
