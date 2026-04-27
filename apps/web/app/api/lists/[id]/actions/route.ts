import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  action: z.enum(["validate", "dedupe", "remove_invalid", "remove_suppressed", "clear"])
});

type Diagnostics = {
  scanned: number;
  valid: number;
  invalid: number;
  duplicatesFound: number;
  duplicatesRemoved: number;
  suppressedFound: number;
  removed: number;
};

const EMAIL_REGEX = "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$";

async function getDiagnostics(listId: string): Promise<Omit<Diagnostics, "duplicatesRemoved" | "removed">> {
  const statsRows = (await prisma.$queryRaw`
    SELECT
      COUNT(*)::bigint AS scanned,
      COUNT(*) FILTER (
        WHERE (r.email ~* ${EMAIL_REGEX}) AND r.status <> 'invalid'
      )::bigint AS valid,
      COUNT(*) FILTER (
        WHERE (r.email !~* ${EMAIL_REGEX}) OR r.status = 'invalid'
      )::bigint AS invalid,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM "SuppressionEntry" s
          WHERE s."emailNormalized" = r."emailNormalized"
            AND (s.scope = 'global' OR (s.scope = 'list' AND s."listId" = ${listId}))
        )
      )::bigint AS suppressed
    FROM "RecipientListMembership" m
    JOIN "Recipient" r ON r.id = m."recipientId"
    WHERE m."listId" = ${listId}
  `) as Array<{ scanned: bigint; valid: bigint; invalid: bigint; suppressed: bigint }>;

  const duplicateRows = (await prisma.$queryRaw`
    WITH ranked AS (
      SELECT ROW_NUMBER() OVER (
        PARTITION BY "listId", "recipientId"
        ORDER BY "createdAt" ASC
      ) AS rn
      FROM "RecipientListMembership"
      WHERE "listId" = ${listId}
    )
    SELECT COUNT(*) FILTER (WHERE rn > 1)::bigint AS duplicates FROM ranked
  `) as Array<{ duplicates: bigint }>;

  const stats = statsRows[0] ?? { scanned: BigInt(0), valid: BigInt(0), invalid: BigInt(0), suppressed: BigInt(0) };
  const duplicates = duplicateRows[0]?.duplicates ?? BigInt(0);
  return {
    scanned: Number(stats.scanned),
    valid: Number(stats.valid),
    invalid: Number(stats.invalid),
    duplicatesFound: Number(duplicates),
    suppressedFound: Number(stats.suppressed)
  };
}

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
    const before = await getDiagnostics(listId);
    const updated = await prisma.$executeRaw`
      UPDATE "Recipient" r
      SET status = 'invalid', "updatedAt" = NOW()
      WHERE r.id IN (
        SELECT m."recipientId" FROM "RecipientListMembership" m WHERE m."listId" = ${listId}
      )
      AND r.email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'
    `;
    const after = await getDiagnostics(listId);
    const result: Diagnostics = {
      ...after,
      duplicatesRemoved: 0,
      removed: 0
    };
    await writeAuditLog(session.userId, "list.validate", "recipient_list", {
      listId,
      markedInvalid: Number(updated),
      result
    });
    return NextResponse.json({ ok: true, result, markedInvalid: Number(updated), before });
  }

  if (parsed.data.action === "dedupe") {
    const before = await getDiagnostics(listId);
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
    const after = await getDiagnostics(listId);
    const result: Diagnostics = {
      ...after,
      duplicatesRemoved: removed,
      removed
    };
    await writeAuditLog(session.userId, "list.dedupe", "recipient_list", { listId, result, before });
    return NextResponse.json({ ok: true, result });
  }

  if (parsed.data.action === "remove_invalid") {
    const before = await getDiagnostics(listId);
    const deletedRows = (await prisma.$queryRaw`
      WITH invalid_memberships AS (
        SELECT m.id
        FROM "RecipientListMembership" m
        JOIN "Recipient" r ON r.id = m."recipientId"
        WHERE m."listId" = ${listId}
          AND (r.status = 'invalid' OR r.email !~* ${EMAIL_REGEX})
      ),
      deleted AS (
        DELETE FROM "RecipientListMembership" m
        USING invalid_memberships im
        WHERE m.id = im.id
        RETURNING m.id
      )
      SELECT COUNT(*)::bigint AS removed FROM deleted
    `) as Array<{ removed: bigint }>;
    const removed = Number(deletedRows[0]?.removed ?? BigInt(0));
    const after = await getDiagnostics(listId);
    const result: Diagnostics = {
      ...after,
      duplicatesRemoved: 0,
      removed
    };
    await writeAuditLog(session.userId, "list.remove_invalid", "recipient_list", { listId, result, before });
    return NextResponse.json({ ok: true, result });
  }

  if (parsed.data.action === "remove_suppressed") {
    const before = await getDiagnostics(listId);
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
    const after = await getDiagnostics(listId);
    const result: Diagnostics = {
      ...after,
      duplicatesRemoved: 0,
      removed
    };
    await writeAuditLog(session.userId, "list.remove_suppressed", "recipient_list", { listId, result, before });
    return NextResponse.json({ ok: true, result });
  }

  const before = await getDiagnostics(listId);
  const cleared = await prisma.recipientListMembership.deleteMany({ where: { listId } });
  const after = await getDiagnostics(listId);
  const result: Diagnostics = {
    ...after,
    duplicatesRemoved: 0,
    removed: cleared.count
  };
  await writeAuditLog(session.userId, "list.clear", "recipient_list", { listId, result, before });
  return NextResponse.json({ ok: true, result });
}
