import { homedir } from "os";
import path from "path";

export function resolveStateHome(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.GSD_STATE_HOME;
  if (explicit) return path.resolve(explicit);
  return path.join(homedir(), ".gsd");
}
