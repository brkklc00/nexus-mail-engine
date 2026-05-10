import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { startAlibabaBackgroundSync } from "@/server/suppression/alibaba-sync";

const schema = z.object({
  startTime: z.string().min(8),
  endTime: z.string().min(8),
  removeFromLists: z.boolean().optional().default(true)
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Geçersiz istek" }, { status: 400 });
  }
  try {
    const summary = await startAlibabaBackgroundSync({
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      removeFromLists: parsed.data.removeFromLists
    });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error("[api/suppression/alibaba-sync/start]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Alibaba senkronizasyonu başlatılamadı. Lütfen tekrar deneyin veya teknik logları kontrol edin.",
        errorCode: "alibaba_sync_start_failed"
      },
      { status: 500 }
    );
  }
}
