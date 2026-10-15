export function parseNamedArg(command: string, argName: string): string | null {
  if (!command || !argName) return null;

  const escaped = argName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\s)${escaped}(?:(?:\\s+|=)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\S+))(?:\\s|$)`
  );
  const match = command.match(pattern);
  if (!match) return null;
  let value = match[1];
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}
