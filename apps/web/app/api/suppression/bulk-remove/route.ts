import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  mode: z.enum(["emails", "selected", "filtered"]),
  emails: z.array(z.string()).optional(),
  ids: z.array(z.string()).optional(),
  filters: z
    .object({
      search: z.string().optional(),
      reason: z.string().optional(),
      source: z.string().optional(),
      scope: z.string().optional(),
      dateRange: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional()
    })
    .optional(),
  confirm: z.literal(true)
});

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeEmails(input: string[]) {
  const valid = new Set<string>();
  let invalidSkipped = 0;
  let duplicatesSkipped = 0;
  for (const raw of input) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      invalidSkipped += 1;
      continue;
    }
    if (valid.has(normalized)) {
      duplicatesSkipped += 1;
      continue;
    }
    valid.add(normalized);
  }
  return { validEmails: [...valid], invalidSkipped, duplicatesSkipped };
}

function buildDateFilter(dateRange?: string, startDate?: string, endDate?: string) {
  const now = new Date();
  if (dateRange === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { gte: start, lte: now };
  }
  if (dateRange === "7d") return { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), lte: now };
  if (dateRange === "30d") return { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), lte: now };
  if (dateRange === "custom" && (startDate || endDate)) {
    return {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate ? { lte: new Date(endDate) } : {})
    };
  }
  return undefined;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Geçersiz istek" }, { status: 400 });
  }

  let scanned = 0;
  let validEmails = 0;
  let invalidSkipped = 0;
  let duplicatesSkipped = 0;
  let removed = 0;
  let notFound = 0;

  if (parsed.data.mode === "emails") {
    const normalized = normalizeEmails(parsed.data.emails ?? []);
    scanned = (parsed.data.emails ?? []).length;
    validEmails = normalized.validEmails.length;
    invalidSkipped = normalized.invalidSkipped;
    duplicatesSkipped = normalized.duplicatesSkipped;
    for (const emailChunk of chunk(normalized.validEmails, 1000)) {
      const result = await prisma.suppressionEntry.deleteMany({
        where: { emailNormalized: { in: emailChunk }, scope: "global" }
      });
      removed += result.count;
    }
    notFound = Math.max(0, validEmails - removed);
  } else if (parsed.data.mode === "selected") {
    const ids = (parsed.data.ids ?? []).filter(Boolean);
    scanned = ids.length;
    if (ids.length > 0) {
      for (const idChunk of chunk(ids, 1000)) {
        const result = await prisma.suppressionEntry.deleteMany({
          where: { id: { in: idChunk } }
        });
        removed += result.count;
      }
    }
    validEmails = ids.length;
    notFound = Math.max(0, ids.length - removed);
  } else {
    const filters = parsed.data.filters ?? {};
    const dateFilter = buildDateFilter(filters.dateRange, filters.startDate, filters.endDate);
    const where = {
      ...(filters.search ? { emailNormalized: { contains: filters.search.trim().toLowerCase() } } : {}),
      ...(filters.reason && filters.reason !== "all" ? { reason: { equals: filters.reason, mode: "insensitive" as const } } : {}),
      ...(filters.source && filters.source !== "all" ? { source: { equals: filters.source, mode: "insensitive" as const } } : {}),
      ...(filters.scope && filters.scope !== "all" ? { scope: filters.scope } : {}),
      ...(dateFilter ? { createdAt: dateFilter } : {})
    };
    scanned = await prisma.suppressionEntry.count({ where });
    validEmails = scanned;
    let cursorId = "";
    while (true) {
      const rows = await prisma.suppressionEntry.findMany({
        where: {
          ...where,
          ...(cursorId ? { id: { gt: cursorId } } : {})
        },
        orderBy: { id: "asc" },
        take: 2000,
        select: { id: true }
      });
      if (rows.length === 0) break;
      const ids = rows.map((row: { id: string }) => row.id);
      const result = await prisma.suppressionEntry.deleteMany({ where: { id: { in: ids } } });
      removed += result.count;
      cursorId = rows[rows.length - 1].id;
    }
    notFound = Math.max(0, scanned - removed);
  }

  await writeAuditLog(session.userId, "suppression_bulk_remove", "suppression", {
    mode: parsed.data.mode,
    removedCount: removed,
    scanned,
    validEmails,
    invalidSkipped,
    duplicatesSkipped,
    sampleMasked: []
  });

  return NextResponse.json({
    ok: true,
    scanned,
    validEmails,
    invalidSkipped,
    duplicatesSkipped,
    removed,
    notFound
  });
}
