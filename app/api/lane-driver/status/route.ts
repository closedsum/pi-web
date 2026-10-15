import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedFileRoots,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { resolveStateHome } from "@/lib/state-home";
import {
  getDaemonStatus,
  projectHash,
} from "@/lib/extensions/lane-driver-manager";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function unknownResponse(reason: string, status = 200) {
  return NextResponse.json(
    {
      status: "unknown",
      heartbeatAgeMs: null,
      reason,
      schemaVersion: 1,
      identityVerified: false,
    },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return unknownResponse("invalid-cwd", 400);
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) {
    return unknownResponse("access-denied", 403);
  }

  try {
    const stateHome = resolveStateHome();
    const hash = projectHash(cwd);
    const result = getDaemonStatus(stateHome, hash);
    return NextResponse.json(
      {
        status: result.status,
        heartbeatAgeMs: result.heartbeatAgeMs,
        reason: result.reason,
        schemaVersion: result.schemaVersion,
        identityVerified: result.identityVerified,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return unknownResponse("internal-error");
  }
}
