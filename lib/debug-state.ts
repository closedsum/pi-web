import type { ExtensionWidgetItem, ExtensionStatusItem } from "@/lib/types";

export interface DebugSessionInfo {
  id: string;
  name?: string;
  cwd?: string;
}

export interface DebugSessionState {
  id: string;
  name?: string;
  cwd?: string;
  alive: boolean;
  extensionWidgetCount: number;
  extensionWidgets: ExtensionWidgetItem[];
  extensionStatusCount: number;
  extensionStatuses: ExtensionStatusItem[];
  _error?: string;
}

export interface DebugStateResponse {
  serverTime: string;
  activeSessions: number;
  aliveSessions: number;
  totalExtensionWidgets: number;
  sessions: DebugSessionState[];
}

export interface SessionStateProvider {
  isAlive(): boolean;
  getState(): Promise<{
    extensionWidgets?: ExtensionWidgetItem[];
    extensionStatuses?: ExtensionStatusItem[];
  }>;
}

export async function buildDebugState(
  sessions: DebugSessionInfo[],
  getProvider: (id: string) => SessionStateProvider | undefined,
): Promise<DebugStateResponse> {
  const sessionStates = await Promise.all(sessions.map(async (session) => {
    const provider = getProvider(session.id);
    const alive = provider?.isAlive() ?? false;
    let extensionWidgets: ExtensionWidgetItem[] = [];
    let extensionStatuses: ExtensionStatusItem[] = [];
    let stateError: string | undefined;
    if (alive && provider) {
      try {
        const state = await provider.getState();
        extensionWidgets = state?.extensionWidgets ?? [];
        extensionStatuses = state?.extensionStatuses ?? [];
      } catch (error) {
        stateError = `getState failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      alive,
      extensionWidgetCount: extensionWidgets.length,
      extensionWidgets,
      extensionStatusCount: extensionStatuses.length,
      extensionStatuses,
      ...(stateError ? { _error: stateError } : {}),
    };
  }));

  return {
    serverTime: new Date().toISOString(),
    activeSessions: sessions.length,
    aliveSessions: sessionStates.filter((s) => s.alive).length,
    totalExtensionWidgets: sessionStates.reduce((n, s) => n + s.extensionWidgetCount, 0),
    sessions: sessionStates,
  };
}
