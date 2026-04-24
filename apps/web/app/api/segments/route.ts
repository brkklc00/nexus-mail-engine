import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  listId: z.string().uuid().optional(),
  includeTag: z.string().optional(),
  excludeTag: z.string().optional()
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const segment = await prisma.segment.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      listId: parsed.data.listId ?? null,
      rules: {
        create: [
          ...(parsed.data.includeTag
            ? [{ field: "tags", operator: "contains" as const, value: parsed.data.includeTag, isExclude: false }]
            : []),
          ...(parsed.data.excludeTag
            ? [{ field: "tags", operator: "contains" as const, value: parsed.data.excludeTag, isExclude: true }]
            : [])
        ]
      }
    },
    include: { rules: true }
  });

  await writeAuditLog(session.userId, "segment.create", "segment", { segmentId: segment.id });
  return NextResponse.json({ ok: true, segment });
}
