import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { runAlibabaSync } from "@/server/suppression/alibaba-sync";

const schema = z.object({
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
    const summary = await runAlibabaSync({
      removeFromLists: parsed.data.removeFromLists,
      reset: false
    });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Alibaba senkronizasyonu devam ettirilemedi" },
      { status: 400 }
    );
  }
}
