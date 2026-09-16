import { NextResponse } from "next/server";
import { getRpcSession, getRpcSessionInfos } from "@/lib/rpc-manager";
import { buildDebugState } from "@/lib/debug-state";

export async function GET() {
  try {
    const sessions = getRpcSessionInfos();
    const result = await buildDebugState(sessions, (id) => {
      const rpc = getRpcSession(id);
      if (!rpc) return undefined;
      return {
        isAlive: () => rpc.isAlive(),
        getState: () => rpc.send({ type: "get_state" }) as Promise<Awaited<ReturnType<import("@/lib/debug-state").SessionStateProvider["getState"]>>>,
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
