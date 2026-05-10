import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { getAlibabaSyncStatus } from "@/server/suppression/alibaba-sync";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await getAlibabaSyncStatus();
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error("[api/suppression/alibaba-sync/status]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Alibaba senkronizasyon durumu alınamadı. Lütfen tekrar deneyin.",
        errorCode: "alibaba_sync_status_failed"
      },
      { status: 500 }
    );
  }
}
