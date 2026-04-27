import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

type LogRow = {
  id: string;
  createdAt: Date;
  source: string;
  event: string;
  severity: string;
  entityType: string;
  message: string | null;
  metadata: unknown;
  campaignId: string | null;
  recipientId: string | null;
  resourceId: string | null;
};

const allowedPageSizes = new Set([25, 50, 100]);

function clampPage(value: string | null): number {
  const parsed = Number(value ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function normalizePageSize(value: string | null): number {
  const parsed = Number(value ?? "25");
  if (!Number.isFinite(parsed)) return 25;
  return allowedPageSizes.has(parsed) ? parsed : 25;
}

function normalizeType(value: string | null): string {
  const allowed = new Set(["all", "campaign", "audit", "worker", "smtp", "list", "template", "suppression"]);
  const normalized = (value ?? "all").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : "all";
}

function normalizeSeverity(value: string | null): string {
  const allowed = new Set(["all", "success", "warning", "error", "info"]);
  const normalized = (value ?? "all").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : "all";
}

function resolveDateWindow(
  range: string | null,
  from: string | null,
  to: string | null
): { fromDate: Date; toDate: Date } {
  const now = new Date();
  const normalized = (range ?? "7d").trim().toLowerCase();
  const toDate = to ? new Date(to) : now;
  if (normalized === "24h") {
    return { fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000), toDate };
  }
  if (normalized === "30d") {
    return { fromDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), toDate };
  }
  if (normalized === "custom" && from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
      return { fromDate, toDate };
    }
  }
  return { fromDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), toDate };
}

const UNION_SQL = Prisma.sql`
  WITH union_logs AS (
    SELECT
      c.id::text AS id,
      c."createdAt" AS "createdAt",
      'campaign'::text AS source,
      c."eventType" AS event,
      CASE
        WHEN c.status = 'failed' THEN 'error'
        WHEN c.status = 'skipped' THEN 'warning'
        ELSE 'success'
      END::text AS severity,
      CASE
        WHEN c."eventType" ILIKE '%smtp%' THEN 'smtp'
        WHEN c."eventType" ILIKE '%worker%' THEN 'worker'
        WHEN c."eventType" ILIKE '%list%' THEN 'list'
        WHEN c."eventType" ILIKE '%template%' THEN 'template'
        WHEN c."eventType" ILIKE '%suppression%' THEN 'suppression'
        ELSE 'campaign'
      END::text AS "entityType",
      c.message AS message,
      c.metadata AS metadata,
      c."campaignId"::text AS "campaignId",
      c."recipientId"::text AS "recipientId",
      NULL::text AS "resourceId"
    FROM "CampaignLog" c

    UNION ALL

    SELECT
      a.id::text AS id,
      a."createdAt" AS "createdAt",
      'audit'::text AS source,
      a.action AS event,
      CASE
        WHEN a.action ILIKE '%error%' OR a.action ILIKE '%fail%' THEN 'error'
        WHEN a.action ILIKE '%delete%' OR a.action ILIKE '%remove%' OR a.action ILIKE '%cancel%' THEN 'warning'
        ELSE 'info'
      END::text AS severity,
      CASE
        WHEN a.resource ILIKE '%smtp%' THEN 'smtp'
        WHEN a.resource ILIKE '%list%' THEN 'list'
        WHEN a.resource ILIKE '%template%' THEN 'template'
        WHEN a.resource ILIKE '%suppression%' THEN 'suppression'
        WHEN a.resource ILIKE '%worker%' THEN 'worker'
        WHEN a.resource ILIKE '%campaign%' THEN 'campaign'
        ELSE 'audit'
      END::text AS "entityType",
      COALESCE(a.metadata->>'message', '') AS message,
      a.metadata AS metadata,
      NULL::text AS "campaignId",
      NULL::text AS "recipientId",
      a."resourceId"::text AS "resourceId"
    FROM "AuditLog" a
  )
`;

function buildWhere(
  query: {
    q: string;
    type: string;
    severity: string;
    event: string;
    fromDate: Date;
    toDate: Date;
  },
  includeEvent: boolean
) {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`"createdAt" >= ${query.fromDate}`,
    Prisma.sql`"createdAt" <= ${query.toDate}`
  ];

  if (query.q) {
    const like = `%${query.q}%`;
    clauses.push(
      Prisma.sql`(
        event ILIKE ${like}
        OR COALESCE(message, '') ILIKE ${like}
        OR "entityType" ILIKE ${like}
      )`
    );
  }

  if (query.type === "audit") {
    clauses.push(Prisma.sql`source = 'audit'`);
  } else if (query.type === "campaign") {
    clauses.push(Prisma.sql`source = 'campaign'`);
  } else if (query.type !== "all") {
    clauses.push(Prisma.sql`"entityType" = ${query.type}`);
  }

  if (query.severity !== "all") {
    clauses.push(Prisma.sql`severity = ${query.severity}`);
  }

  if (includeEvent && query.event) {
    clauses.push(Prisma.sql`event = ${query.event}`);
  }

  return clauses.length > 0 ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.sql``;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = clampPage(url.searchParams.get("page"));
  const pageSize = normalizePageSize(url.searchParams.get("pageSize"));
  const q = (url.searchParams.get("q") ?? "").trim();
  const type = normalizeType(url.searchParams.get("type"));
  const severity = normalizeSeverity(url.searchParams.get("severity"));
  const event = (url.searchParams.get("event") ?? "").trim();
  const { fromDate, toDate } = resolveDateWindow(
    url.searchParams.get("range"),
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );

  const whereWithEvent = buildWhere({ q, type, severity, event, fromDate, toDate }, true);
  const whereWithoutEvent = buildWhere({ q, type, severity, event, fromDate, toDate }, false);
  const offset = (page - 1) * pageSize;

  const [items, totalRows, eventRows] = await Promise.all([
    prisma.$queryRaw<LogRow[]>`
      ${UNION_SQL}
      SELECT
        id, "createdAt", source, event, severity, "entityType", message, metadata, "campaignId", "recipientId", "resourceId"
      FROM union_logs
      ${whereWithEvent}
      ORDER BY "createdAt" DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      ${UNION_SQL}
      SELECT COUNT(*)::bigint AS total
      FROM union_logs
      ${whereWithEvent}
    `,
    prisma.$queryRaw<Array<{ event: string; count: bigint }>>`
      ${UNION_SQL}
      SELECT event, COUNT(*)::bigint AS count
      FROM union_logs
      ${whereWithoutEvent}
      GROUP BY event
      ORDER BY count DESC
      LIMIT 100
    `
  ]);

  const total = Number(totalRows[0]?.total ?? BigInt(0));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return NextResponse.json({
    ok: true,
    items: items.map((item: LogRow) => ({
      ...item,
      createdAt: item.createdAt.toISOString()
    })),
    total,
    page,
    pageSize,
    totalPages,
    events: eventRows.map((entry: { event: string }) => entry.event)
  });
}
