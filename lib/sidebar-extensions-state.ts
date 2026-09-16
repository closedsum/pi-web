export const EXTENSIONS_OPEN_STORAGE_KEY = "pi-web:sidebar-extensions:open";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadExtensionsOpen(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(EXTENSIONS_OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveExtensionsOpen(
  open: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(EXTENSIONS_OPEN_STORAGE_KEY, String(open));
  } catch {
    // storage unavailable — silently degrade
  }
}
