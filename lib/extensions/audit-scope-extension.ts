import path from "path";
import { realpathSync } from "fs";
import type { BlockResult } from "./types";

const FILE_TOOLS = new Set(["Write", "Edit", "Delete"]);

export interface AuditScope {
  files: Set<string>;
  creates: Set<string>;
}

export function decodeScope(token: string): AuditScope {
  let parsed: { files?: string[]; creates?: string[] };
  try {
    const json = Buffer.from(token, "base64url").toString("utf-8");
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid scope token: failed to decode base64url JSON");
  }

  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("Invalid scope token: files array is required and must be non-empty");
  }

  return {
    files: new Set(parsed.files.map((f) => path.resolve(f))),
    creates: new Set((parsed.creates ?? []).map((f) => path.resolve(f))),
  };
}

function hasTraversal(filePath: string): boolean {
  return filePath.split(/[\\/]+/).includes("..");
}

function resolveRealTarget(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    const dir = path.dirname(filePath);
    try {
      const realDir = realpathSync.native(dir);
      return path.join(realDir, path.basename(filePath));
    } catch {
      return path.resolve(filePath);
    }
  }
}

export function checkAuditScope(
  toolName: string,
  input: Record<string, unknown>,
  scopeToken: string | undefined,
): BlockResult | undefined {
  if (!scopeToken) return undefined;
  if (!FILE_TOOLS.has(toolName)) return undefined;

  const filePath = input.file_path as string | undefined;
  if (!filePath || typeof filePath !== "string") {
    return { block: true, reason: "AUDIT_SCOPE: file_path is missing or not a string" };
  }

  if (!path.isAbsolute(filePath)) {
    return { block: true, reason: `AUDIT_SCOPE: non-absolute path rejected: ${filePath}` };
  }

  if (hasTraversal(filePath)) {
    return { block: true, reason: `AUDIT_SCOPE: TRAVERSAL detected in path: ${filePath}` };
  }

  let scope: AuditScope;
  try {
    scope = decodeScope(scopeToken);
  } catch (err) {
    return { block: true, reason: `AUDIT_SCOPE: ${(err as Error).message}` };
  }

  const resolved = resolveRealTarget(filePath);
  const normalized = path.resolve(filePath);

  if (resolved !== normalized) {
    if (!scope.files.has(resolved) && !scope.creates.has(resolved)) {
      return { block: true, reason: `AUDIT_SCOPE: symlink escape blocked — resolved to ${resolved} which is OUT_OF_SCOPE` };
    }
    return undefined;
  }

  if (scope.files.has(normalized)) return undefined;
  if (scope.creates.has(normalized)) return undefined;

  return { block: true, reason: `OUT_OF_SCOPE: ${normalized} is not in the audit scope` };
}
