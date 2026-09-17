export interface BoardTask {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blockedBy: string[];
  blocks: string[];
  metadata: Record<string, unknown>;
  owner: string;
  session_id: string;
  created_at: string;
  completed_at: string | null;
}

export interface TaskBoardData {
  tasks: BoardTask[];
  counts: { pending: number; in_progress: number; completed: number };
  lastModified: string | null;
}

export function parseBoard(lines: string[]): BoardTask[] {
  const byKey = new Map<string, BoardTask>();
  const order: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (!obj.subject) continue;
      const task = obj as BoardTask;
      const key = `${task.id}\0${task.session_id}`;
      if (!byKey.has(key)) order.push(key);
      byKey.set(key, task);
    } catch {
      // skip malformed lines
    }
  }
  return order.map((k) => byKey.get(k)!);
}

export function countByStatus(tasks: BoardTask[]): TaskBoardData["counts"] {
  const counts = { pending: 0, in_progress: 0, completed: 0 };
  for (const task of tasks) {
    if (task.status in counts) counts[task.status as keyof typeof counts]++;
  }
  return counts;
}
