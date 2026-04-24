import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await prisma.suppressionEntry.delete({ where: { id } });
  await writeAuditLog(session.userId, "suppression.remove", "suppression", { suppressionId: id });
  return NextResponse.json({ ok: true });
}
