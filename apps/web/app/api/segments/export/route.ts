import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { exportSegmentCsvStream } from "@/server/segments/segment-query.service";

const schema = z.object({
  query: z.any().default({}),
  mode: z.enum(["matched", "clicked", "not_clicked", "opened", "not_opened", "failed", "suppressed"]).default("matched"),
  search: z.string().optional(),
  fileName: z.string().optional()
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const stream = exportSegmentCsvStream({
    query: parsed.data.query ?? {},
    mode: parsed.data.mode,
    search: parsed.data.search
  });
  const fileName = (parsed.data.fileName ?? `segment-${parsed.data.mode}.csv`).replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store"
    }
  });
}
