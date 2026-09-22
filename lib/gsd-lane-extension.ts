import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { execFile, spawn } from "node:child_process";
import { writeFile, mkdir, open, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readAllDispatches } from "./dispatch-status";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);

export const GSD_LANE_EXTENSION_NAME = "pi-web-gsd-lanes";

export type DispatchFailureClass = "infra" | "ownership" | "unknown";

const OWNERSHIP_PATTERNS = [
  "already a worktree", "already checked out",
  "scope conflict", "already has a running lane", "already running",
];

export const ORCH_ALLOW = new Set(["read", "grep", "find", "ls", "glob", "search", "DispatchLane", "CheckLaneStatus", "CheckDispatchStatus", "ue_dispatch"]);

export function classifyDispatchFailure(error: string): DispatchFailureClass {
  const lower = error.toLowerCase();
  if (OWNERSHIP_PATTERNS.some((p) => lower.includes(p))) return "ownership";
  if (lower.includes("spawn") || lower.includes("enoent") || lower.includes("not found") ||
      lower.includes("queue build failed") || lower.includes("did not start") ||
      lower.includes("failed to resolve head") || lower.includes("plan validation failed") ||
      lower.includes("spec missing sections")) {
    return "infra";
  }
  return "unknown";
}

export interface GsdLaneExtensionOptions {
  cwd: string;
  gsdBinDir?: string;
  python?: string;
}

function sanitizeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.\./g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function uniqueSlug(base: string): string {
  const safe = sanitizeSlug(base);
  const suffix = randomBytes(3).toString("hex");
  return safe ? `${safe}-${suffix}` : `lane-${suffix}`;
}

async function resolveWorktreeRoot(python: string, gsdBinDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(python, [
      join(gsdBinDir, "gsd-config.py"),
      "get", "impl_lanes.temp_worktree_root",
    ], { timeout: 10_000 });
    const root = stdout.trim();
    if (root) return root;
  } catch {}
  return join(tmpdir(), "pi-lanes");
}

async function resolveModel(python: string, gsdBinDir: string): Promise<{ provider: string; model: string; effort: string } | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      join(gsdBinDir, "gsd_impl_lane.py"),
      "resolve-model",
    ], { timeout: 10_000 });
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed.provider === "string" && typeof parsed.model === "string" && typeof parsed.effort === "string") {
      return parsed as { provider: string; model: string; effort: string };
    }
    return null;
  } catch {
    return null;
  }
}

export function createGsdLaneExtension(options: GsdLaneExtensionOptions): InlineExtension {
  const gsdBinDir = options.gsdBinDir || join(
    process.env.HOME || process.env.USERPROFILE || "",
    "gsd-config", "get-shit-done", "bin",
  );
  const python = options.python || "python";

  return {
    name: GSD_LANE_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      // ORCH_ALLOW is module-level (exported for rpc-manager prompt boundary)
      const MAX_BLOCKS_PER_TURN = 3;
      let blocksThisTurn = 0;
      let mode: "orchestrator" | "inline" = "orchestrator";

      const MODE_ENTRY_TYPE = "gsd-orchestrator-mode";
      const FAILURE_ENTRY_TYPE = "gsd-dispatch-failure";
      let autoFlipped = false;

      pi.on("session_start", (_ev, ctx) => {
        const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: Record<string, unknown> }>;
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          if (e.type === "custom" && e.customType === MODE_ENTRY_TYPE && e.data?.mode) {
            mode = e.data.mode === "inline" ? "inline" : "orchestrator";
            return;
          }
        }
      });

      pi.on("turn_start", () => { blocksThisTurn = 0; });

      pi.on("turn_end", () => {
        if (autoFlipped) {
          mode = "orchestrator";
          autoFlipped = false;
        }
      });

      function recordFailure(error: string, slug: string) {
        const failureClass = classifyDispatchFailure(error);
        pi.appendEntry(FAILURE_ENTRY_TYPE, {
          slug,
          class: failureClass,
          error,
          timestamp: new Date().toISOString(),
        });
        pi.sendMessage({
          customType: "gsd-lane-lifecycle",
          content: `Lane failed: ${slug} [${failureClass}]\n${error}`,
          display: true,
        }, { triggerTurn: false });
        if (failureClass === "infra") {
          mode = "inline";
          autoFlipped = true;
        }
      }

      pi.on("tool_call", (ev: { toolName: string }) => {
        if (mode !== "orchestrator") return undefined;
        if (ORCH_ALLOW.has(ev.toolName)) return undefined;
        blocksThisTurn++;
        const terminate = blocksThisTurn >= MAX_BLOCKS_PER_TURN;
        return {
          block: true,
          terminate,
          reason: `'${ev.toolName}' is unavailable in orchestrator mode. Delegate with DispatchLane or reply to the user with your analysis.${terminate ? " Tool budget exhausted — respond now." : ""}`,
        };
      });

      let dispatchCountThisTurn = 0;
      let lastTurnTimestamp = 0;
      const TURN_WINDOW_MS = 10_000;
      const MAX_DISPATCHES_PER_TURN = 1;

      function checkTurnGuard(): string | null {
        const now = Date.now();
        if (now - lastTurnTimestamp > TURN_WINDOW_MS) {
          dispatchCountThisTurn = 0;
          lastTurnTimestamp = now;
        }
        dispatchCountThisTurn++;
        if (dispatchCountThisTurn > MAX_DISPATCHES_PER_TURN) {
          return `Dispatch limit reached (${MAX_DISPATCHES_PER_TURN} per turn). Stop and respond to the user with your analysis. Do not call DispatchLane again this turn.`;
        }
        return null;
      }

      pi.registerTool(defineTool({
        name: "DispatchLane",
        label: "Dispatch Lane",
        description: "Dispatch an implementation task to an autonomous lane. You are an orchestrator — you must NEVER implement changes directly (no edit/write/bash/powershell). Instead, describe the task and call this tool. The lane handles implementation, cross-review, fix rounds, and integration in an isolated worktree.",
        promptSnippet: "Dispatch implementation work to an autonomous GSD lane",
        promptGuidelines: [
          "CRITICAL ORCHESTRATOR RULE: You must NEVER edit files, run powershell/bash commands, or implement changes directly. Your ONLY job is to (1) briefly explain what you will do in text, then (2) call DispatchLane to send the work to an autonomous agent. The lane agent does the actual implementation — you do not.",
          "ALWAYS include a text response BEFORE calling DispatchLane. Example: 'I'll fix the PIE polling to bind to the editor PID.' then call DispatchLane with the task details.",
          "Do NOT dispatch for pure questions: git history, code explanation, status checks. Answer those with read/grep tools directly. DO dispatch when the user asks to fix, change, add, refactor, or investigate-and-fix anything — even if investigation is needed first.",
          "Call DispatchLane EXACTLY ONCE per request. If the dispatch fails, report the failure to the user — do NOT retry. The auto-recovery system handles retries internally.",
          "For UE operations (launch editor, open map, start PIE, spawn): use ue_dispatch immediately — no file reading needed. These are fire-and-forget.",
        ],
        executionMode: "parallel",
        parameters: Type.Object({
          task: Type.String({ description: "Complete task description for the lane agent. Be specific — include file paths, what to change, and why." }),
          slug: Type.Optional(Type.String({ description: "Short kebab-case identifier (auto-generated from task if omitted)." })),
          write_scope: Type.Optional(Type.Array(Type.String(), { description: "Glob patterns limiting which files the lane may modify (e.g. ['lib/**', 'components/**'])." })),
          title: Type.Optional(Type.String({ description: "Short title for the commit message." })),
          skip_review: Type.Optional(Type.Boolean({ description: "Skip cross-review (for trivial changes only)." })),
        }),
        async execute(_toolCallId, params) {
          const guardMessage = checkTurnGuard();
          if (guardMessage) {
            return { content: [{ type: "text", text: guardMessage }], details: undefined, isError: true };
          }

          const slug = uniqueSlug(sanitizeSlug(params.slug || params.task));
          const repo = resolve(options.cwd);

          const worktreeRoot = await resolveWorktreeRoot(python, gsdBinDir);
          const worktreePath = join(worktreeRoot, `pi-${slug}`);
          const branchName = `lane/${slug}`;

          let head: string;
          try {
            const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo, timeout: 5_000 });
            head = stdout.trim();
            if (!head || !/^[0-9a-f]{7,40}$/.test(head)) {
              const msg = `Failed to resolve HEAD in ${repo}: unexpected output "${head}"`;
              recordFailure(msg, slug);
              return { content: [{ type: "text", text: msg }], details: undefined, isError: true };
            }
          } catch (err) {
            const msg = `Failed to resolve HEAD in ${repo}: ${err instanceof Error ? err.message : String(err)}`;
            recordFailure(msg, slug);
            return { content: [{ type: "text", text: msg }], details: undefined, isError: true };
          }

          const resolved = await resolveModel(python, gsdBinDir);

          const lanesDir = join(repo, ".planning", "impl-lanes");
          await mkdir(lanesDir, { recursive: true });

          const specPath = join(lanesDir, `spec-${slug}.md`);
          await writeFile(specPath, `# ${params.title || slug}\n\n${params.task}\n`, "utf-8");

          const taskId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

          const laneParams: Record<string, unknown> = {
            Slug: slug,
            Task: taskId,
            Repo: repo,
            Title: params.title || params.task.split(/[.\n]/)[0].slice(0, 80),
            Message: params.task,
            SpecFile: specPath,
            ScopeGlobs: params.write_scope || [],
            Worktree: worktreePath,
            Branch: branchName,
            Base: head,
            SkipImpl: false,
            SkipReview: params.skip_review || false,
            ExpectedCommits: 1,
          };

          if (resolved) {
            laneParams.Provider = resolved.provider;
            laneParams.Model = resolved.model;
            laneParams.Effort = resolved.effort;
            laneParams.ModelReason = "resolved from routing config";
          }

          const paramsPath = join(lanesDir, `p-${slug}-params.json`);
          await writeFile(paramsPath, JSON.stringify(laneParams, null, 2), "utf-8");

          const queuePath = join(lanesDir, `q-${slug}.json`);

          try {
            await execFileAsync(python, [
              join(gsdBinDir, "gsd_impl_lane.py"),
              "build-queue",
              "--queue-file", queuePath,
              "--params-file", paramsPath,
            ], { cwd: repo, timeout: 30_000 });
          } catch (err) {
            const msg = `Lane queue build failed for ${slug}: ${err instanceof Error ? err.message : String(err)}`;
            recordFailure(msg, slug);
            return { content: [{ type: "text", text: msg }], details: undefined, isError: true };
          }

          const logPath = join(lanesDir, `log-${slug}.txt`);
          const logFd = await open(logPath, "a");

          const child = spawn(python, [
            join(gsdBinDir, "gsd_impl_lane.py"),
            "queue",
            "--queue-file", queuePath,
            "--max-pipelines", "1",
          ], {
            cwd: repo,
            detached: true,
            stdio: ["ignore", logFd.fd, logFd.fd],
            windowsHide: true,
          });

          const pid = child.pid;

          if (!pid) {
            logFd.close().catch(() => {});
            const msg = `Lane spawn failed for ${slug}: process did not start`;
            recordFailure(msg, slug);
            return { content: [{ type: "text", text: msg }], details: undefined, isError: true };
          }

          child.on("error", (err) => {
            logFd.write(`spawn error: ${err.message}\n`).then(() => logFd.close()).catch(() => {});
          });
          child.on("exit", (code) => {
            logFd.close().catch(() => {});
            if (code !== 0 && code !== null) {
              const manifestPath = join(lanesDir, `p-${slug}.json`);
              readFile(manifestPath, "utf-8").then((raw) => {
                const data = JSON.parse(raw);
                return (data._error as string) || "";
              }).catch(() => "").then((manifestError) => {
                const reason = manifestError || `exit code ${code}`;
                const msg = `Lane ${slug} failed: ${reason}`;
                recordFailure(msg, slug);
                pi.sendMessage({
                  customType: "gsd-lane-lifecycle",
                  content: `Lane failed: ${slug}\nReason: ${reason}\nLog: ${logPath}\nAnalyze the failure and decide whether to retry or inform the user.`,
                  display: true,
                }, { triggerTurn: true });
              });
            }
          });
          child.unref();

          const title = params.title || params.task.split(/[.\n]/)[0].slice(0, 80);
          pi.sendMessage({
            customType: "gsd-lane-lifecycle",
            content: `Lane dispatched: ${slug}\n${title}`,
            display: true,
          }, { triggerTurn: false });

          return {
            content: [{
              type: "text",
              text: [
                `Lane dispatched: ${slug} (pid ${pid})`,
                `Worktree: ${worktreePath}`,
                `Branch: ${branchName}`,
                `Base: ${head.slice(0, 8)}`,
                resolved ? `Model: ${resolved.model} (${resolved.effort})` : "",
                params.skip_review ? "Review: skipped" : "Review: enabled",
                `Log: ${logPath}`,
                "",
                "The lane is running autonomously. Use CheckLaneStatus to check progress.",
              ].filter(Boolean).join("\n"),
            }],
            details: undefined,
          };
        },
      }));

      pi.registerTool(defineTool({
        name: "CheckLaneStatus",
        label: "Check Lane Status",
        description: "Check the current status of dispatched lanes. Returns deterministic JSON from lane manifests.",
        promptSnippet: "Check status of dispatched implementation lanes",
        parameters: Type.Object({
          slug: Type.Optional(Type.String({ description: "Filter to a specific lane slug. Omit to see all lanes." })),
        }),
        async execute(_toolCallId, params) {
          const repo = resolve(options.cwd);
          const result = await readAllDispatches(repo);
          let items = result.dispatches.filter((d) => d.source === "lane");
          if (params.slug) {
            items = items.filter((d) => d.id === params.slug);
          }
          if (items.length === 0) {
            return {
              content: [{ type: "text", text: params.slug ? `No lane found with slug "${params.slug}".` : "No dispatched lanes found." }],
              details: undefined,
            };
          }
          const output = items.map((d) => ({
            id: d.id,
            status: d.status,
            phase: d.phase ?? null,
            startedAt: d.startedAt,
            finishedAt: d.finishedAt ?? null,
            error: d.error ?? null,
          }));
          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            details: undefined,
          };
        },
      }));

      pi.registerTool(defineTool({
        name: "CheckDispatchStatus",
        label: "Check Dispatch Status",
        description: "Check the status of ALL dispatched work — lanes and UE dispatches. Returns deterministic JSON. Use after DispatchLane or ue_dispatch to check completion, detect crashes, or verify results. ALWAYS call this after dispatching work to confirm the outcome.",
        promptSnippet: "Check status of all dispatched work (lanes + UE dispatches)",
        parameters: Type.Object({
          source: Type.Optional(Type.Union([Type.Literal("lane"), Type.Literal("ue_dispatch")], { description: "Filter by source type. Omit to see all." })),
        }),
        async execute(_toolCallId, params) {
          const repo = resolve(options.cwd);
          const result = await readAllDispatches(repo);
          let items = result.dispatches;
          if (params.source) {
            items = items.filter((d) => d.source === params.source);
          }
          if (items.length === 0) {
            return {
              content: [{ type: "text", text: "No dispatched work found." }],
              details: undefined,
            };
          }
          const output = items.map((d) => ({
            id: d.id,
            source: d.source,
            status: d.status,
            phase: d.phase ?? null,
            startedAt: d.startedAt,
            finishedAt: d.finishedAt ?? null,
            error: d.error ?? null,
            steps: d.steps ?? null,
          }));
          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            details: undefined,
          };
        },
      }));
    },
  };
}
