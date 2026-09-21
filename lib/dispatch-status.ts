import fs from "node:fs";
import path from "node:path";

export type DisplayCategory = "active" | "success" | "failed" | "blocked";

export interface DispatchItem {
  id: string;
  title: string;
  status: string;
  displayCategory: DisplayCategory;
  phase?: string;
  source: "lane" | "ue_dispatch";
  startedAt: string;
  finishedAt?: string;
  pid?: number;
  error?: string;
  steps?: Array<{ label: string; done: boolean }>;
}

export interface DispatchStatusData {
  dispatches: DispatchItem[];
}

const CATEGORY_MAP: Record<string, DisplayCategory> = {
  starting: "active",
  running: "active",
  done: "success",
  finished: "success",
  integrated: "success",
  failed: "failed",
  review_failed: "failed",
  timed_out: "failed",
  orphaned: "failed",
  blocked: "blocked",
  cancelled: "blocked",
};

function toDisplayCategory(status: string): DisplayCategory {
  return CATEGORY_MAP[status] ?? "active";
}

function readLaneManifests(cwd: string): DispatchItem[] {
  const lanesDir = path.join(cwd, ".planning", "impl-lanes");
  let entries: string[];
  try {
    entries = fs.readdirSync(lanesDir);
  } catch {
    return [];
  }

  const manifests: DispatchItem[] = [];
  for (const name of entries) {
    if (!name.startsWith("p-") || !name.endsWith(".json")) continue;
    if (name.includes("-params.json")) continue;

    try {
      const raw = fs.readFileSync(path.join(lanesDir, name), "utf-8");
      const data = JSON.parse(raw);
      if (data.type !== "pipeline" || !data.slug) continue;

      const status = data.status || "unknown";
      manifests.push({
        id: data.slug,
        title: data.title || data.slug,
        status,
        displayCategory: toDisplayCategory(status),
        phase: data.phase,
        source: "lane",
        startedAt: data.start || "",
        finishedAt: data.end,
        pid: data.pid,
        error: data._error,
      });
    } catch {
      // skip malformed files
    }
  }
  return manifests;
}

function readUeDispatch(cwd: string): DispatchItem[] {
  const filePath = path.join(cwd, ".planning", "threads", "dispatch-progress.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (!data.id) return [];

    const startedAt = typeof data.started_at === "number"
      ? new Date(data.started_at * 1000).toISOString()
      : String(data.started_at || "");

    const finishedAt = typeof data.finished_at === "number"
      ? new Date(data.finished_at * 1000).toISOString()
      : data.finished_at ? String(data.finished_at) : undefined;

    const steps = Array.isArray(data.steps)
      ? data.steps.map((s: { text?: string; done?: boolean }) => ({
          label: s.text || "",
          done: Boolean(s.done),
        }))
      : undefined;

    const status = data.status || "unknown";
    return [{
      id: data.id,
      title: data.subject || data.id,
      status,
      displayCategory: toDisplayCategory(status),
      source: "ue_dispatch" as const,
      startedAt,
      finishedAt,
      steps,
    }];
  } catch {
    return [];
  }
}

export async function readAllDispatches(cwd: string): Promise<DispatchStatusData> {
  const lanes = readLaneManifests(cwd);
  const ue = readUeDispatch(cwd);
  const all = [...lanes, ...ue];

  all.sort((a, b) => {
    const ta = a.startedAt || "";
    const tb = b.startedAt || "";
    return tb.localeCompare(ta);
  });

  return { dispatches: all };
}
