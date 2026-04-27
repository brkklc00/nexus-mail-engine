import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { getSegmentMatchedCount } from "@/server/segments/segment-query.service";

const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  listId: z.string().uuid().optional(),
  queryConfig: z.any().optional()
});

function clampPage(value: string | null): number {
  const parsed = Number(value ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function normalizePageSize(value: string | null): number {
  const parsed = Number(value ?? "25");
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return [25, 50, 100].includes(parsed) ? parsed : 25;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = clampPage(url.searchParams.get("page"));
  const pageSize = normalizePageSize(url.searchParams.get("pageSize"));
  const search = (url.searchParams.get("search") ?? "").trim();
  const includeArchived = (url.searchParams.get("includeArchived") ?? "false").toLowerCase() === "true";
  const where: any = {
    ...(includeArchived ? {} : { isArchived: false }),
    ...(search
      ? {
          OR: [{ name: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }]
        }
      : {})
  };

  const [items, total] = await Promise.all([
    prisma.segment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        list: { select: { id: true, name: true } },
        _count: { select: { campaigns: true, rules: true } }
      }
    }),
    prisma.segment.count({ where })
  ]);

  const listAnalytics = await Promise.all(
    items.map(async (segment: any) => {
      const matchedCount = await getSegmentMatchedCount((segment.queryConfig as any) ?? { baseListId: segment.listId ?? null });
      await prisma.segment.update({
        where: { id: segment.id },
        data: {
          lastCalculatedAt: new Date(),
          lastMatchedCount: matchedCount
        }
      });
      return {
        id: segment.id,
        name: segment.name,
        description: segment.description,
        isArchived: segment.isArchived,
        list: segment.list,
        rulesSummary: segment.queryConfig ?? { listId: segment.listId },
        matchedCount,
        lastCalculatedAt: new Date().toISOString(),
        campaignsUsing: segment._count.campaigns
      };
    })
  );

  return NextResponse.json({
    ok: true,
    items: listAnalytics,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const segment = await prisma.segment.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      listId: parsed.data.listId ?? null,
      queryConfig: parsed.data.queryConfig ?? null
    },
    include: { rules: true }
  });

  await writeAuditLog(session.userId, "segment.create", "segment", { segmentId: segment.id });
  return NextResponse.json({ ok: true, segment });
}
