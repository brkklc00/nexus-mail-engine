import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;
  const removedRows = (await prisma.$queryRaw`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY "listId", "recipientId"
        ORDER BY "createdAt" ASC
      ) AS rn
      FROM "RecipientListMembership"
      WHERE "listId" = ${listId}
    ),
    deleted AS (
      DELETE FROM "RecipientListMembership" m
      USING ranked r
      WHERE m.id = r.id
        AND r.rn > 1
      RETURNING m.id
    )
    SELECT COUNT(*)::bigint AS removed FROM deleted
  `) as Array<{ removed: bigint }>;
  const removed = Number(removedRows[0]?.removed ?? BigInt(0));

  await writeAuditLog(session.userId, "list.dedupe", "recipient_list", { listId, removed });
  return NextResponse.json({ ok: true, removed });
}
