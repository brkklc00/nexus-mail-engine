import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { resumeAlibabaSync } from "@/server/suppression/alibaba-sync";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await resumeAlibabaSync();
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Alibaba senkronizasyonu devam ettirilemedi" },
      { status: 400 }
    );
  }
}
