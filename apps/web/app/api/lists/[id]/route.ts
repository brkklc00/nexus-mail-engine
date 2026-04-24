import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  name: z.string().min(2).optional(),
  maxSize: z.number().int().positive().max(1_000_000).optional(),
  tags: z.array(z.string()).optional()
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const list = await prisma.recipientList.findUnique({
    where: { id },
    include: {
      memberships: {
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { recipient: true }
      },
      _count: { select: { memberships: true } }
    }
  });
  if (!list) {
    return NextResponse.json({ ok: false, error: "List not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, list });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const list = await prisma.recipientList.update({
    where: { id },
    data: parsed.data
  });
  await writeAuditLog(session.userId, "list.update", "recipient_list", { listId: id });
  return NextResponse.json({ ok: true, list });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  await prisma.$transaction(async (tx: any) => {
    await tx.segment.deleteMany({ where: { listId: id } });
    await tx.recipientList.delete({ where: { id } });
  });
  await writeAuditLog(session.userId, "list.delete", "recipient_list", { listId: id });
  return NextResponse.json({ ok: true });
}
