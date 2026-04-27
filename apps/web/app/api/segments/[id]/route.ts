import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  listId: z.string().uuid().nullable().optional(),
  queryConfig: z.any().optional(),
  isArchived: z.boolean().optional(),
  action: z.enum(["duplicate"]).optional()
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const segment = await prisma.segment.findUnique({ where: { id } });
  if (!segment) {
    return NextResponse.json({ ok: false, error: "Segment not found" }, { status: 404 });
  }

  if (parsed.data.action === "duplicate") {
    const duplicated = await prisma.segment.create({
      data: {
        name: `${segment.name} (copy)`,
        description: segment.description,
        listId: segment.listId,
        queryConfig: segment.queryConfig,
        isArchived: false
      }
    });
    await writeAuditLog(session.userId, "segment.duplicate", "segment", { sourceSegmentId: id, segmentId: duplicated.id });
    return NextResponse.json({ ok: true, segment: duplicated });
  }

  const updated = await prisma.segment.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.listId !== undefined ? { listId: parsed.data.listId } : {}),
      ...(parsed.data.queryConfig !== undefined ? { queryConfig: parsed.data.queryConfig } : {}),
      ...(parsed.data.isArchived !== undefined ? { isArchived: parsed.data.isArchived } : {})
    }
  });
  await writeAuditLog(session.userId, "segment.update", "segment", { segmentId: id });
  return NextResponse.json({ ok: true, segment: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const usage = await prisma.campaign.count({ where: { segmentId: id } });
  if (usage > 0) {
    return NextResponse.json(
      { ok: false, code: "segment_in_use", error: "Segment is used by campaigns. Archive it first.", campaignsUsing: usage },
      { status: 409 }
    );
  }

  await prisma.segment.delete({ where: { id } });
  await writeAuditLog(session.userId, "segment.delete", "segment", { segmentId: id });
  return NextResponse.json({ ok: true });
}
