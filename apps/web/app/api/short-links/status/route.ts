import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { getShortenerStatus } from "@/server/short-links/nxusurl.service";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const status = getShortenerStatus();
  return NextResponse.json({
    ok: true,
    connected: status.configured,
    baseUrl: status.baseUrl || "not_configured",
    apiKeyPresent: status.configured ? "yes" : "no"
  });
}

