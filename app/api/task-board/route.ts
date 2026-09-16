import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { parseBoard, countByStatus, type TaskBoardData } from "@/lib/task-board";

const BOARD_REL_PATH = ".planning/threads/board.jsonl";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const boardPath = path.join(cwd, BOARD_REL_PATH);
    let content: string;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(boardPath);
      content = fs.readFileSync(boardPath, "utf-8");
    } catch {
      const result: TaskBoardData = { tasks: [], counts: { pending: 0, in_progress: 0, completed: 0 }, lastModified: null };
      return NextResponse.json(result);
    }

    const tasks = parseBoard(content.split("\n"));
    const result: TaskBoardData = {
      tasks,
      counts: countByStatus(tasks),
      lastModified: stat.mtime.toISOString(),
    };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
