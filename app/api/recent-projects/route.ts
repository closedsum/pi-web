import fs from "fs";
import path from "path";
import { homedir } from "os";
import { NextRequest, NextResponse } from "next/server";

const RECENT_PROJECTS_PATH = path.join(homedir(), ".pi", "recent-projects.json");
const MAX_RECENT = 10;

interface RecentProject {
  cwd: string;
  name: string;
  lastOpened: string;
}

function readRecent(): RecentProject[] {
  try {
    const data = fs.readFileSync(RECENT_PROJECTS_PATH, "utf-8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecent(projects: RecentProject[]): void {
  const dir = path.dirname(RECENT_PROJECTS_PATH);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  fs.writeFileSync(RECENT_PROJECTS_PATH, JSON.stringify(projects, null, 2), "utf-8");
}

export async function GET() {
  return NextResponse.json({ projects: readRecent() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

    const name = typeof body.name === "string" ? body.name : path.basename(cwd);
    const projects = readRecent();
    const filtered = projects.filter((p) => p.cwd !== cwd);
    filtered.unshift({ cwd, name, lastOpened: new Date().toISOString() });
    const trimmed = filtered.slice(0, MAX_RECENT);
    writeRecent(trimmed);
    return NextResponse.json({ projects: trimmed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
