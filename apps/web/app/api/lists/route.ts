import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  name: z.string().min(2),
  notes: z.string().max(2000).optional(),
  maxSize: z.number().int().positive().max(5_000_000).optional(),
  tags: z.array(z.string()).default([])
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

  const list = await prisma.recipientList.create({
    data: {
      name: parsed.data.name,
      notes: parsed.data.notes ?? null,
      maxSize: parsed.data.maxSize ?? 1_000_000,
      tags: parsed.data.tags
    }
  });
  await writeAuditLog(session.userId, "list.create", "recipient_list", { listId: list.id });
  return NextResponse.json({ ok: true, list });
}
