import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { resetAlibabaSyncState } from "@/server/suppression/alibaba-sync";

const schema = z.object({
  confirm: z.literal(true)
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Onay gerekli" }, { status: 400 });
  }
  const summary = await resetAlibabaSyncState();
  return NextResponse.json({ ok: true, summary });
}
