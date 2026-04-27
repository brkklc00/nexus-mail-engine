import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { runSegmentAnalytics } from "@/server/segments/segment-query.service";

const schema = z.object({
  query: z.any().default({}),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(50),
  search: z.string().optional()
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

  try {
    const result = await runSegmentAnalytics({
      query: parsed.data.query ?? {},
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      search: parsed.data.search
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 });
  }
}
