import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  name: z.string().min(2).optional(),
  notes: z.string().max(2000).nullable().optional(),
  maxSize: z.number().int().positive().max(5_000_000).optional(),
  tags: z.array(z.string()).optional()
});

function normalizePage(raw: string | null): number {
  const value = Number(raw ?? "1");
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const page = normalizePage(searchParams.get("page"));
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const list = await prisma.recipientList.findUnique({ where: { id } });
  if (!list) {
    return NextResponse.json({ ok: false, error: "List not found" }, { status: 404 });
  }

  const metricsRows = (await prisma.$queryRaw`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE r.status <> 'invalid')::bigint AS valid,
      COUNT(*) FILTER (WHERE r.status = 'invalid')::bigint AS invalid,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM "SuppressionEntry" s
          WHERE s."emailNormalized" = r."emailNormalized"
            AND (s.scope = 'global' OR (s.scope = 'list' AND s."listId" = ${id}))
        )
      )::bigint AS suppressed
    FROM "RecipientListMembership" m
    JOIN "Recipient" r ON r.id = m."recipientId"
    WHERE m."listId" = ${id}
  `) as Array<{ total: bigint; valid: bigint; invalid: bigint; suppressed: bigint }>;

  const metrics = metricsRows[0] ?? { total: BigInt(0), valid: BigInt(0), invalid: BigInt(0), suppressed: BigInt(0) };

  const importLogs = await prisma.auditLog.findMany({
    where: { action: { in: ["list.import_recipients", "list.import_bulk"] } },
    orderBy: { createdAt: "desc" },
    take: 150
  });
  const latestImport = importLogs.find((log: any) => {
    const metadata = log.metadata as Record<string, unknown> | null;
    return metadata?.listId === id;
  });

  const summary = {
    totalRecipients: Number(metrics.total),
    validCount: Number(metrics.valid),
    invalidCount: Number(metrics.invalid),
    suppressedCount: Number(metrics.suppressed),
    duplicateSkippedCount: Number(
      ((latestImport?.metadata as Record<string, unknown> | null)?.duplicateSkipped ??
        (latestImport?.metadata as Record<string, unknown> | null)?.duplicateCount ??
        0) as number
    ),
    lastImportDate: latestImport?.createdAt?.toISOString() ?? null
  };

  if (!q) {
    return NextResponse.json({
      ok: true,
      list: {
        id: list.id,
        name: list.name,
        notes: list.notes,
        tags: list.tags,
        maxSize: list.maxSize,
        createdAt: list.createdAt.toISOString(),
        summary
      }
    });
  }

  const rows = await prisma.recipientListMembership.findMany({
    where: {
      listId: id,
      recipient: {
        emailNormalized: { contains: q }
      }
    },
    include: {
      recipient: {
        select: {
          id: true,
          email: true,
          emailNormalized: true,
          name: true,
          status: true,
          updatedAt: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: pageSize
  });

  const totalMatches = await prisma.recipientListMembership.count({
    where: {
      listId: id,
      recipient: {
        emailNormalized: { contains: q }
      }
    }
  });

  return NextResponse.json({
    ok: true,
    list: {
      id: list.id,
      name: list.name,
      notes: list.notes,
      tags: list.tags,
      maxSize: list.maxSize,
      createdAt: list.createdAt.toISOString(),
      summary
    },
    search: {
      query: q,
      page,
      pageSize,
      totalMatches,
      rows: rows.map((row: any) => ({
        membershipId: row.id,
        recipientId: row.recipient.id,
        email: row.recipient.email,
        emailNormalized: row.recipient.emailNormalized,
        name: row.recipient.name,
        status: row.recipient.status,
        updatedAt: row.recipient.updatedAt.toISOString()
      }))
    }
  });
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
    await tx.recipientListMembership.deleteMany({ where: { listId: id } });
    await tx.recipientList.delete({ where: { id } });
  });
  await writeAuditLog(session.userId, "list.delete", "recipient_list", { listId: id });
  return NextResponse.json({ ok: true });
}
