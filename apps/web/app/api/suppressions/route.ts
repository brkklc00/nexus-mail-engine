import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const createSchema = z.object({
  email: z.string().email(),
  reason: z.string().min(2),
  source: z.string().optional(),
  scope: z.enum(["global", "list"]).default("global"),
  listId: z.string().uuid().optional()
});

const bulkSchema = z.object({
  text: z.string().optional(),
  emails: z.array(z.string()).optional(),
  reason: z.string().min(2),
  source: z.string().optional(),
  scope: z.enum(["global", "list"]).default("global"),
  listId: z.string().uuid().optional()
});

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function parseMixedEmails(input: { text?: string; emails?: string[] }): {
  processed: number;
  validUnique: string[];
  invalidSkipped: number;
  duplicates: number;
} {
  const sourceText = [input.text ?? "", ...(input.emails ?? [])].join("\n");
  const rawCandidates = sourceText
    .replace(/[;,]+/g, "\n")
    .split(/\r?\n/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      const matches = trimmed.match(emailRegex);
      return matches && matches.length > 0 ? matches : [trimmed];
    });

  const seen = new Set<string>();
  const validUnique: string[] = [];
  let duplicates = 0;
  let invalidSkipped = 0;

  for (const candidate of rawCandidates) {
    const normalized = candidate.trim().toLowerCase();
    if (!z.string().email().safeParse(normalized).success) {
      invalidSkipped += 1;
      continue;
    }
    if (seen.has(normalized)) {
      duplicates += 1;
      continue;
    }
    seen.add(normalized);
    validUnique.push(normalized);
  }

  return {
    processed: rawCandidates.length,
    validUnique,
    invalidSkipped,
    duplicates
  };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSizeCandidate = Number(url.searchParams.get("pageSize") ?? "25");
  const pageSize = [25, 50, 100].includes(pageSizeCandidate) ? pageSizeCandidate : 25;
  const offset = (page - 1) * pageSize;

  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const reason = (url.searchParams.get("reason") ?? "").trim();
  const source = (url.searchParams.get("source") ?? "").trim();
  const scope = (url.searchParams.get("scope") ?? "").trim();
  const range = (url.searchParams.get("range") ?? "7d").trim();
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  let fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDate = toRaw ? new Date(toRaw) : new Date();
  if (range === "24h") fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (range === "30d") fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (range === "custom" && fromRaw) {
    const candidate = new Date(fromRaw);
    if (!Number.isNaN(candidate.getTime())) fromDate = candidate;
  }

  const where = {
    ...(q ? { emailNormalized: { contains: q } } : {}),
    ...(reason ? { reason: { contains: reason, mode: "insensitive" as const } } : {}),
    ...(source ? { source: { contains: source, mode: "insensitive" as const } } : {}),
    ...(scope && scope !== "all" ? { scope } : {}),
    createdAt: {
      gte: fromDate,
      lte: toDate
    }
  };

  const [items, total, reasonOptionsRows, sourceOptionsRows] = await Promise.all([
    prisma.suppressionEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: pageSize
    }),
    prisma.suppressionEntry.count({ where }),
    prisma.suppressionEntry.groupBy({
      by: ["reason"],
      _count: { _all: true },
      orderBy: { _count: { reason: "desc" } },
      take: 100
    }),
    prisma.suppressionEntry.groupBy({
      by: ["source"],
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
      take: 100
    })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return NextResponse.json({
    ok: true,
    items: items.map((item: any) => ({
      id: item.id,
      email: item.email,
      reason: item.reason,
      source: item.source,
      scope: item.scope,
      createdAt: item.createdAt.toISOString()
    })),
    total,
    page,
    pageSize,
    totalPages,
    reasonOptions: reasonOptionsRows.map((row: any) => row.reason),
    sourceOptions: sourceOptionsRows.map((row: any) => row.source).filter((value: any): value is string => Boolean(value))
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await req.json();

  if (Array.isArray(payload.emails) || typeof payload.text === "string") {
    const parsedBulk = bulkSchema.safeParse(payload);
    if (!parsedBulk.success) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const parsed = parseMixedEmails({
      text: parsedBulk.data.text,
      emails: parsedBulk.data.emails
    });
    if (parsed.validUnique.length === 0) {
      return NextResponse.json({
        ok: true,
        summary: {
          processed: parsed.processed,
          added: 0,
          duplicates: parsed.duplicates,
          invalidSkipped: parsed.invalidSkipped,
          alreadySuppressed: 0
        }
      });
    }

    const existing = new Set<string>();
    for (const emailChunk of chunk(parsed.validUnique, 1000)) {
      const rows = await prisma.suppressionEntry.findMany({
        where: {
          emailNormalized: { in: emailChunk },
          scope: parsedBulk.data.scope
        },
        select: { emailNormalized: true }
      });
      for (const row of rows) existing.add(row.emailNormalized);
    }

    const addable = parsed.validUnique.filter((email) => !existing.has(email));
    let added = 0;
    for (const emailChunk of chunk(addable, 1000)) {
      const created = await prisma.suppressionEntry.createMany({
        data: emailChunk.map((emailNormalized) => ({
          email: emailNormalized,
          emailNormalized,
          reason: parsedBulk.data.reason,
          source: parsedBulk.data.source ?? "manual",
          scope: parsedBulk.data.scope,
          listId: parsedBulk.data.scope === "list" ? parsedBulk.data.listId ?? null : null
        })),
        skipDuplicates: true
      });
      added += created.count;
    }

    const summary = {
      processed: parsed.processed,
      added,
      duplicates: parsed.duplicates,
      invalidSkipped: parsed.invalidSkipped,
      alreadySuppressed: existing.size
    };
    await writeAuditLog(session.userId, "suppression.bulk_add", "suppression", summary);
    return NextResponse.json({ ok: true, summary });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const normalized = parsed.data.email.trim().toLowerCase();
  const entry = await prisma.suppressionEntry.upsert({
    where: { emailNormalized_scope: { emailNormalized: normalized, scope: parsed.data.scope } },
    create: {
      email: parsed.data.email,
      emailNormalized: normalized,
      reason: parsed.data.reason,
      source: parsed.data.source ?? "manual",
      scope: parsed.data.scope,
      listId: parsed.data.scope === "list" ? parsed.data.listId ?? null : null
    },
    update: {
      reason: parsed.data.reason,
      source: parsed.data.source ?? "manual",
      listId: parsed.data.scope === "list" ? parsed.data.listId ?? null : null
    }
  });
  await writeAuditLog(session.userId, "suppression.add", "suppression", { suppressionId: entry.id });
  return NextResponse.json({ ok: true, entry });
}
