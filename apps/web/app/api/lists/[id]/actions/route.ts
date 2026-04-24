import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  action: z.enum(["validate", "dedupe", "remove_invalid", "remove_suppressed", "clear"])
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  if (parsed.data.action === "validate") {
    const updated = await prisma.$executeRaw`
      UPDATE "Recipient" r
      SET status = 'invalid', "updatedAt" = NOW()
      WHERE r.id IN (
        SELECT m."recipientId" FROM "RecipientListMembership" m WHERE m."listId" = ${listId}
      )
      AND r.email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'
    `;
    await writeAuditLog(session.userId, "list.validate", "recipient_list", { listId, markedInvalid: Number(updated) });
    return NextResponse.json({ ok: true, result: { markedInvalid: Number(updated) } });
  }

  if (parsed.data.action === "dedupe") {
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
    return NextResponse.json({ ok: true, result: { removed } });
  }

  if (parsed.data.action === "remove_invalid") {
    const deleted = await prisma.recipientListMembership.deleteMany({
      where: {
        listId,
        recipient: { status: "invalid" }
      }
    });
    await writeAuditLog(session.userId, "list.remove_invalid", "recipient_list", {
      listId,
      removed: deleted.count
    });
    return NextResponse.json({ ok: true, result: { removed: deleted.count } });
  }

  if (parsed.data.action === "remove_suppressed") {
    const rows = (await prisma.$queryRaw`
      WITH suppressed_memberships AS (
        SELECT m.id
        FROM "RecipientListMembership" m
        JOIN "Recipient" r ON r.id = m."recipientId"
        WHERE m."listId" = ${listId}
          AND EXISTS (
            SELECT 1
            FROM "SuppressionEntry" s
            WHERE s."emailNormalized" = r."emailNormalized"
              AND (s.scope = 'global' OR (s.scope = 'list' AND s."listId" = ${listId}))
          )
      ),
      deleted AS (
        DELETE FROM "RecipientListMembership" m
        USING suppressed_memberships sm
        WHERE m.id = sm.id
        RETURNING m.id
      )
      SELECT COUNT(*)::bigint AS removed FROM deleted
    `) as Array<{ removed: bigint }>;
    const removed = Number(rows[0]?.removed ?? BigInt(0));
    await writeAuditLog(session.userId, "list.remove_suppressed", "recipient_list", { listId, removed });
    return NextResponse.json({ ok: true, result: { removed } });
  }

  const cleared = await prisma.recipientListMembership.deleteMany({ where: { listId } });
  await writeAuditLog(session.userId, "list.clear", "recipient_list", { listId, removed: cleared.count });
  return NextResponse.json({ ok: true, result: { removed: cleared.count } });
}
