import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { getAlibabaSyncStatus } from "@/server/suppression/alibaba-sync";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const summary = await getAlibabaSyncStatus();
  return NextResponse.json({ ok: true, summary });
}
