import { Prisma } from "@prisma/client";
import { prisma } from "@nexus/db";

export type SegmentQueryInput = {
  baseListId?: string | null;
  campaignId?: string | null;
  templateId?: string | null;
  listId?: string | null;
  smtpAccountId?: string | null;
  from?: string | null;
  to?: string | null;
  engagement?: {
    opened?: boolean;
    notOpened?: boolean;
    clicked?: boolean;
    notClicked?: boolean;
    unsubscribed?: boolean;
  };
  delivery?: Array<"sent" | "failed" | "skipped" | "suppressed">;
  emailDomain?: string | null;
  suppressionMode?: "all" | "include" | "exclude";
  previousCampaignMode?: "all" | "include" | "exclude";
};

type NormalizedSegmentQuery = {
  baseListId: string | null;
  campaignId: string | null;
  templateId: string | null;
  listId: string | null;
  smtpAccountId: string | null;
  from: Date | null;
  to: Date | null;
  engagement: {
    opened: boolean;
    notOpened: boolean;
    clicked: boolean;
    notClicked: boolean;
    unsubscribed: boolean;
  };
  delivery: Array<"sent" | "failed" | "skipped" | "suppressed">;
  emailDomain: string | null;
  suppressionMode: "all" | "include" | "exclude";
  previousCampaignMode: "all" | "include" | "exclude";
};

function bool(value: unknown): boolean {
  return value === true;
}

export function normalizeSegmentQuery(input: SegmentQueryInput | null | undefined): NormalizedSegmentQuery {
  return {
    baseListId: input?.baseListId?.trim() || null,
    campaignId: input?.campaignId?.trim() || null,
    templateId: input?.templateId?.trim() || null,
    listId: input?.listId?.trim() || null,
    smtpAccountId: input?.smtpAccountId?.trim() || null,
    from: input?.from ? new Date(input.from) : null,
    to: input?.to ? new Date(input.to) : null,
    engagement: {
      opened: bool(input?.engagement?.opened),
      notOpened: bool(input?.engagement?.notOpened),
      clicked: bool(input?.engagement?.clicked),
      notClicked: bool(input?.engagement?.notClicked),
      unsubscribed: bool(input?.engagement?.unsubscribed)
    },
    delivery: Array.from(new Set((input?.delivery ?? []).filter((item) => ["sent", "failed", "skipped", "suppressed"].includes(item)))),
    emailDomain: input?.emailDomain?.trim().toLowerCase() || null,
    suppressionMode: input?.suppressionMode === "include" || input?.suppressionMode === "exclude" ? input.suppressionMode : "all",
    previousCampaignMode:
      input?.previousCampaignMode === "include" || input?.previousCampaignMode === "exclude" ? input.previousCampaignMode : "all"
  };
}

function andSql(clauses: Prisma.Sql[]): Prisma.Sql {
  if (clauses.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`${Prisma.join(clauses, " AND ")}`;
}

function campaignClauses(query: NormalizedSegmentQuery, alias: string): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];
  if (query.campaignId) clauses.push(Prisma.sql`${Prisma.raw(alias)}."id" = ${query.campaignId}`);
  if (query.templateId) clauses.push(Prisma.sql`${Prisma.raw(alias)}."templateId" = ${query.templateId}`);
  if (query.listId) clauses.push(Prisma.sql`${Prisma.raw(alias)}."listId" = ${query.listId}`);
  if (query.smtpAccountId) clauses.push(Prisma.sql`${Prisma.raw(alias)}."smtpAccountId" = ${query.smtpAccountId}`);
  if (query.from && !Number.isNaN(query.from.getTime())) clauses.push(Prisma.sql`${Prisma.raw(alias)}."createdAt" >= ${query.from}`);
  if (query.to && !Number.isNaN(query.to.getTime())) clauses.push(Prisma.sql`${Prisma.raw(alias)}."createdAt" <= ${query.to}`);
  return clauses;
}

function eventDateClauses(query: NormalizedSegmentQuery, alias: string): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];
  if (query.from && !Number.isNaN(query.from.getTime())) clauses.push(Prisma.sql`${Prisma.raw(alias)}."createdAt" >= ${query.from}`);
  if (query.to && !Number.isNaN(query.to.getTime())) clauses.push(Prisma.sql`${Prisma.raw(alias)}."createdAt" <= ${query.to}`);
  return clauses;
}

export function buildRecipientWhereSql(
  query: NormalizedSegmentQuery,
  options?: { search?: string; idAfter?: string }
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  const campaignFilter = andSql(campaignClauses(query, "c"));
  if (query.baseListId) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "RecipientListMembership" m
      WHERE m."recipientId" = r."id" AND m."listId" = ${query.baseListId}
    )`);
  }
  if (options?.search?.trim()) {
    const term = `%${options.search.trim().toLowerCase()}%`;
    clauses.push(Prisma.sql`(LOWER(r."email") LIKE ${term} OR LOWER(COALESCE(r."name", '')) LIKE ${term})`);
  }
  if (query.emailDomain) {
    clauses.push(Prisma.sql`LOWER(r."emailNormalized") LIKE ${`%@${query.emailDomain}`}`);
  }
  if (options?.idAfter) {
    clauses.push(Prisma.sql`r."id" > ${options.idAfter}`);
  }

  if (query.engagement.opened) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "OpenEvent" oe
      JOIN "Campaign" c ON c."id" = oe."campaignId"
      WHERE oe."recipientId" = r."id"
        AND ${campaignFilter}
        AND ${andSql(eventDateClauses(query, "oe"))}
    )`);
  }
  if (query.engagement.notOpened) {
    clauses.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "OpenEvent" oe
      JOIN "Campaign" c ON c."id" = oe."campaignId"
      WHERE oe."recipientId" = r."id"
        AND ${campaignFilter}
        AND ${andSql(eventDateClauses(query, "oe"))}
    )`);
  }
  if (query.engagement.clicked) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ClickEvent" ce
      JOIN "Campaign" c ON c."id" = ce."campaignId"
      WHERE ce."recipientId" = r."id"
        AND ${campaignFilter}
        AND ${andSql(eventDateClauses(query, "ce"))}
    )`);
  }
  if (query.engagement.notClicked) {
    clauses.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "ClickEvent" ce
      JOIN "Campaign" c ON c."id" = ce."campaignId"
      WHERE ce."recipientId" = r."id"
        AND ${campaignFilter}
        AND ${andSql(eventDateClauses(query, "ce"))}
    )`);
  }
  if (query.engagement.unsubscribed) {
    clauses.push(Prisma.sql`(
      r."status" = 'unsubscribed'
      OR EXISTS (
        SELECT 1 FROM "CampaignLog" cl
        JOIN "Campaign" c ON c."id" = cl."campaignId"
        WHERE cl."recipientId" = r."id"
          AND cl."eventType" ILIKE '%unsubscribe%'
          AND ${campaignFilter}
          AND ${andSql(eventDateClauses(query, "cl"))}
      )
    )`);
  }

  const deliveryStatuses = query.delivery.filter((status) => status !== "suppressed");
  if (deliveryStatuses.length > 0) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM "CampaignRecipient" cr
      JOIN "Campaign" c ON c."id" = cr."campaignId"
      WHERE cr."recipientId" = r."id"
        AND cr."sendStatus" IN (${Prisma.join(deliveryStatuses)})
        AND ${campaignFilter}
        AND ${andSql(eventDateClauses(query, "cr"))}
    )`);
  }

  if (query.delivery.includes("suppressed") || query.suppressionMode === "include") {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "SuppressionEntry" s
      WHERE s."emailNormalized" = r."emailNormalized" AND s."scope" = 'global'
    )`);
  }
  if (query.suppressionMode === "exclude") {
    clauses.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "SuppressionEntry" s
      WHERE s."emailNormalized" = r."emailNormalized" AND s."scope" = 'global'
    )`);
  }

  if (query.previousCampaignMode === "include") {
    clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "CampaignRecipient" cr WHERE cr."recipientId" = r."id")`);
  }
  if (query.previousCampaignMode === "exclude") {
    clauses.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "CampaignRecipient" cr WHERE cr."recipientId" = r."id")`);
  }

  return andSql(clauses);
}

async function getCount(sql: Prisma.Sql): Promise<number> {
  const rows = (await prisma.$queryRaw(sql)) as Array<{ count: bigint }>;
  return Number(rows[0]?.count ?? 0);
}

function matchedCte(whereSql: Prisma.Sql) {
  return Prisma.sql`WITH matched AS (
    SELECT r."id", r."email", r."emailNormalized", r."status"
    FROM "Recipient" r
    WHERE ${whereSql}
  )`;
}

export async function runSegmentAnalytics(input: {
  query: SegmentQueryInput;
  page: number;
  pageSize: number;
  search?: string;
}): Promise<{
  stats: {
    matchedRecipients: number;
    openedCount: number;
    notOpenedCount: number;
    clickedCount: number;
    notClickedCount: number;
    failedCount: number;
    suppressedCount: number;
    unsubscribeCount: number;
    topDomains: Array<{ domain: string; count: number }>;
    topClickedLinks: Array<{ url: string; clicks: number }>;
  };
  sample: Array<{ id: string; email: string; status: string; domain: string }>;
  pagination: { page: number; pageSize: number };
}> {
  const query = normalizeSegmentQuery(input.query);
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.max(1, Math.min(50, Number(input.pageSize || 50)));
  const whereSql = buildRecipientWhereSql(query, { search: input.search });
  const cte = matchedCte(whereSql);

  const [matchedRecipients, openedCount, clickedCount, failedCount, suppressedCount, unsubscribeCount, sampleRows, domains, links] =
    await Promise.all([
      getCount(Prisma.sql`${cte} SELECT COUNT(*)::bigint as count FROM matched`),
      getCount(
        Prisma.sql`${cte}
          SELECT COUNT(*)::bigint as count
          FROM matched m
          WHERE EXISTS (SELECT 1 FROM "OpenEvent" oe WHERE oe."recipientId" = m."id")`
      ),
      getCount(
        Prisma.sql`${cte}
          SELECT COUNT(*)::bigint as count
          FROM matched m
          WHERE EXISTS (SELECT 1 FROM "ClickEvent" ce WHERE ce."recipientId" = m."id")`
      ),
      getCount(
        Prisma.sql`${cte}
          SELECT COUNT(*)::bigint as count
          FROM matched m
          WHERE EXISTS (
            SELECT 1 FROM "CampaignRecipient" cr
            WHERE cr."recipientId" = m."id" AND cr."sendStatus" = 'failed'
          )`
      ),
      getCount(
        Prisma.sql`${cte}
          SELECT COUNT(*)::bigint as count
          FROM matched m
          WHERE EXISTS (
            SELECT 1 FROM "SuppressionEntry" s
            WHERE s."emailNormalized" = m."emailNormalized" AND s."scope" = 'global'
          )`
      ),
      getCount(
        Prisma.sql`${cte}
          SELECT COUNT(*)::bigint as count
          FROM matched m
          WHERE m."status" = 'unsubscribed'
             OR EXISTS (
              SELECT 1 FROM "CampaignLog" cl
              WHERE cl."recipientId" = m."id"
                AND cl."eventType" ILIKE '%unsubscribe%'
             )`
      ),
      prisma.$queryRaw(
        Prisma.sql`${cte}
          SELECT m."id", m."email", m."status", SPLIT_PART(m."emailNormalized", '@', 2) as domain
          FROM matched m
          ORDER BY m."id" ASC
          LIMIT ${pageSize}
          OFFSET ${(page - 1) * pageSize}`
      ) as Promise<Array<{ id: string; email: string; status: string; domain: string }>>,
      prisma.$queryRaw(
        Prisma.sql`${cte}
          SELECT SPLIT_PART(m."emailNormalized", '@', 2) as domain, COUNT(*)::bigint as count
          FROM matched m
          GROUP BY 1
          ORDER BY count DESC
          LIMIT 8`
      ) as Promise<Array<{ domain: string; count: bigint }>>,
      prisma.$queryRaw(
        Prisma.sql`${cte}
          SELECT COALESCE(cl."originalUrl", ce."targetUrl") as url, COUNT(*)::bigint as clicks
          FROM "ClickEvent" ce
          JOIN matched m ON m."id" = ce."recipientId"
          LEFT JOIN "CampaignLink" cl ON cl."id" = ce."campaignLinkId"
          GROUP BY 1
          ORDER BY clicks DESC
          LIMIT 8`
      ) as Promise<Array<{ url: string; clicks: bigint }>>
    ]);

  const notOpenedCount = Math.max(0, matchedRecipients - openedCount);
  const notClickedCount = Math.max(0, matchedRecipients - clickedCount);
  return {
    stats: {
      matchedRecipients,
      openedCount,
      notOpenedCount,
      clickedCount,
      notClickedCount,
      failedCount,
      suppressedCount,
      unsubscribeCount,
      topDomains: domains.map((item: { domain: string; count: bigint }) => ({ domain: item.domain || "-", count: Number(item.count) })),
      topClickedLinks: links.map((item: { url: string; clicks: bigint }) => ({ url: item.url || "-", clicks: Number(item.clicks) }))
    },
    sample: sampleRows.slice(0, 50),
    pagination: { page, pageSize }
  };
}

export async function getSegmentMatchedCount(queryInput: SegmentQueryInput): Promise<number> {
  const normalized = normalizeSegmentQuery(queryInput);
  const whereSql = buildRecipientWhereSql(normalized);
  return getCount(Prisma.sql`SELECT COUNT(*)::bigint as count FROM "Recipient" r WHERE ${whereSql}`);
}

type ExportMode =
  | "matched"
  | "clicked"
  | "not_clicked"
  | "opened"
  | "not_opened"
  | "failed"
  | "suppressed";

function withExportMode(query: NormalizedSegmentQuery, mode: ExportMode): NormalizedSegmentQuery {
  const next: NormalizedSegmentQuery = { ...query, engagement: { ...query.engagement }, delivery: [...query.delivery] };
  if (mode === "clicked") next.engagement.clicked = true;
  if (mode === "not_clicked") next.engagement.notClicked = true;
  if (mode === "opened") next.engagement.opened = true;
  if (mode === "not_opened") next.engagement.notOpened = true;
  if (mode === "failed" && !next.delivery.includes("failed")) next.delivery.push("failed");
  if (mode === "suppressed") next.suppressionMode = "include";
  return next;
}

function csvEscape(value: string | number | null | undefined): string {
  const v = `${value ?? ""}`.replaceAll('"', '""');
  return `"${v}"`;
}

export function exportSegmentCsvStream(input: {
  query: SegmentQueryInput;
  mode: ExportMode;
  search?: string;
}) {
  const normalized = withExportMode(normalizeSegmentQuery(input.query), input.mode);
  const encoder = new TextEncoder();
  const chunkSize = 2000;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("recipient_id,email,email_normalized,status,domain\n"));
      let cursor: string | null = null;
      while (true) {
        const whereSql = buildRecipientWhereSql(normalized, { search: input.search, idAfter: cursor ?? undefined });
        const rows = (await prisma.$queryRaw(
          Prisma.sql`
            SELECT r."id", r."email", r."emailNormalized", r."status", SPLIT_PART(r."emailNormalized", '@', 2) as domain
            FROM "Recipient" r
            WHERE ${whereSql}
            ORDER BY r."id" ASC
            LIMIT ${chunkSize}
          `
        )) as Array<{ id: string; email: string; emailNormalized: string; status: string; domain: string }>;
        if (rows.length === 0) {
          break;
        }
        const lines = rows
          .map((row: { id: string; email: string; emailNormalized: string; status: string; domain: string }) =>
            [
              csvEscape(row.id),
              csvEscape(row.email),
              csvEscape(row.emailNormalized),
              csvEscape(row.status),
              csvEscape(row.domain)
            ].join(",")
          )
          .join("\n");
        controller.enqueue(encoder.encode(`${lines}\n`));
        cursor = rows[rows.length - 1].id;
      }
      controller.close();
    }
  });
}

export async function listSegmentRecipientIds(input: {
  query: SegmentQueryInput;
  take: number;
  cursor?: string | null;
}): Promise<Array<{ id: string; emailNormalized: string; status: string }>> {
  const normalized = normalizeSegmentQuery(input.query);
  const whereSql = buildRecipientWhereSql(normalized, { idAfter: input.cursor ?? undefined });
  return (prisma.$queryRaw(
    Prisma.sql`
      SELECT r."id", r."emailNormalized", r."status"
      FROM "Recipient" r
      WHERE ${whereSql}
      ORDER BY r."id" ASC
      LIMIT ${Math.max(1, Math.min(5000, input.take))}
    `
  ) as Promise<Array<{ id: string; emailNormalized: string; status: string }>>);
}
