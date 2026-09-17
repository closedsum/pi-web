import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { execFile, spawn } from "node:child_process";
import { writeFile, mkdir, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const execFileAsync = promisify(execFile);

export const GSD_LANE_EXTENSION_NAME = "pi-web-gsd-lanes";

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
      pi.registerTool(defineTool({
        name: "DispatchLane",
        label: "Dispatch Lane",
        description: "Dispatch an implementation task to a GSD lane that runs autonomously in an isolated worktree. The lane handles implementation, cross-review, fix rounds, and integration. Use this for any task that modifies code — it keeps the chat responsive while work runs in the background. The task panel shows lane progress.",
        promptSnippet: "Dispatch implementation work to an autonomous GSD lane",
        promptGuidelines: [
          "Use DispatchLane for any task that will edit files — never run Edit/Write inline when a lane can do it.",
          "Provide a clear, specific task description. The lane agent receives only this text.",
          "Include file paths and scope when you know them.",
          "The lane runs autonomously: implement → review → fix → integrate.",
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
              return { content: [{ type: "text", text: `Failed to resolve HEAD in ${repo}: unexpected output "${head}"` }], details: undefined, isError: true };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Failed to resolve HEAD in ${repo}: ${msg}` }], details: undefined, isError: true };
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
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Lane queue build failed for ${slug}: ${msg}` }], details: undefined, isError: true };
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
            return { content: [{ type: "text", text: `Lane spawn failed for ${slug}: process did not start` }], details: undefined, isError: true };
          }

          child.on("error", (err) => {
            logFd.write(`spawn error: ${err.message}\n`).then(() => logFd.close()).catch(() => {});
          });
          child.on("exit", () => {
            logFd.close().catch(() => {});
          });
          child.unref();

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
                "The lane is running autonomously. Progress is visible in the task panel.",
              ].filter(Boolean).join("\n"),
            }],
            details: undefined,
          };
        },
      }));
    },
  };
}
