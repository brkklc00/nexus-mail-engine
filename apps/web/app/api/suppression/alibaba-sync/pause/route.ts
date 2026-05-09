import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { pauseAlibabaSync } from "@/server/suppression/alibaba-sync";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const summary = await pauseAlibabaSync();
  return NextResponse.json({ ok: true, summary });
}
