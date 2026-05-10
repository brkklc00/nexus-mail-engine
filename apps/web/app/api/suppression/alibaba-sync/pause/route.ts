import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { pauseAlibabaSync } from "@/server/suppression/alibaba-sync";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await pauseAlibabaSync();
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error("[api/suppression/alibaba-sync/pause]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Alibaba senkronizasyonu duraklatılamadı. Lütfen tekrar deneyin veya teknik logları kontrol edin.",
        errorCode: "alibaba_sync_pause_failed"
      },
      { status: 500 }
    );
  }
}
