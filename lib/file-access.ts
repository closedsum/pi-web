import { readdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;

export interface AllowedRootSources {
  sessions?: Array<{ cwd?: string; projectRoot?: string }>;
  recentProjects?: string[];
  piCwdDirs?: string[];
  additional?: Set<string>;
}

export function collectAllowedRoots(sources: AllowedRootSources): Set<string> {
  const roots = new Set<string>();
  for (const s of sources.sessions ?? []) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }
  for (const p of sources.recentProjects ?? []) {
    if (p) roots.add(normalizeSlashes(p));
  }
  for (const d of sources.piCwdDirs ?? []) {
    roots.add(normalizeSlashes(d));
  }
  for (const r of sources.additional ?? []) {
    roots.add(r);
  }
  return roots;
}

function readPiCwdDirs(): string[] {
  try {
    const dirs: string[] = [];
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        dirs.push(path.join(homedir(), name));
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

export function readRecentProjectPaths(): string[] {
  try {
    const filePath = path.join(homedir(), ".pi", "recent-projects.json");
    const data = JSON.parse(require("fs").readFileSync(filePath, "utf-8"));
    if (!Array.isArray(data)) return [];
    return data.map((p: { cwd?: string }) => p.cwd).filter((c): c is string => Boolean(c));
  } catch {
    return [];
  }
}

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const roots = collectAllowedRoots({
    sessions: await listAllSessions(),
    recentProjects: readRecentProjectPaths(),
    piCwdDirs: readPiCwdDirs(),
    additional: getAdditionalAllowedRoots(),
  });

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}
