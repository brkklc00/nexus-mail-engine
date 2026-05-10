import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { resumeAlibabaSync } from "@/server/suppression/alibaba-sync";

export async function POST(_req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await resumeAlibabaSync();
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("Kaldığı yer bilgisi")) {
      return NextResponse.json({ ok: false, error: msg, errorCode: "alibaba_sync_resume_not_ready" }, { status: 400 });
    }
    console.error("[api/suppression/alibaba-sync/continue]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Alibaba senkronizasyonu devam ettirilemedi. Lütfen tekrar deneyin veya teknik logları kontrol edin.",
        errorCode: "alibaba_sync_continue_failed"
      },
      { status: 500 }
    );
  }
}
