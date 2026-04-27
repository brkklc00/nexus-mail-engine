import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const statusSchema = z.enum(["draft", "active", "archived", "disabled"]);

const createSchema = z.object({
  title: z.string().min(2),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
  plainTextBody: z.string().optional(),
  category: z.string().optional().nullable(),
  status: z.enum(["draft", "active"]).optional()
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
  const status = (url.searchParams.get("status") ?? "all").trim();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const sort = (url.searchParams.get("sort") ?? "updated_desc").trim();
  const where: any = {
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { subject: { contains: search, mode: "insensitive" } },
            { category: { contains: search, mode: "insensitive" } }
          ]
        }
      : {}),
    ...(status !== "all" ? { status: statusSchema.parse(status) } : {}),
    ...(tag ? { category: { contains: tag, mode: "insensitive" } } : {})
  };

  const orderBy =
    sort === "created_desc"
      ? ({ createdAt: "desc" } as const)
      : sort === "name"
        ? ({ title: "asc" } as const)
        : sort === "usage_count"
          ? ({ campaigns: { _count: "desc" } } as const)
          : ({ updatedAt: "desc" } as const);

  const [items, total, categories] = await Promise.all([
    prisma.mailTemplate.findMany({
      where,
      include: {
        _count: { select: { campaigns: true } }
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.mailTemplate.count({ where }),
    prisma.mailTemplate.findMany({
      where: { category: { not: null } },
      select: { category: true },
      orderBy: { category: "asc" },
      take: 300
    })
  ]);

  const categoryOptions = Array.from(
    new Set(categories.map((item: any) => item.category).filter((value: any) => typeof value === "string" && value.trim().length > 0))
  ) as string[];

  return NextResponse.json({
    ok: true,
    items: items.map((item: any) => ({
      id: item.id,
      title: item.title,
      subject: item.subject,
      htmlBody: item.htmlBody,
      plainTextBody: item.plainTextBody,
      category: item.category,
      version: item.version,
      status: item.status,
      usageCount: item._count?.campaigns ?? 0,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    categories: categoryOptions
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const template = await prisma.mailTemplate.create({
    data: {
      title: parsed.data.title,
      subject: parsed.data.subject,
      htmlBody: parsed.data.htmlBody,
      plainTextBody: parsed.data.plainTextBody ?? null,
      category: parsed.data.category ?? null,
      status: parsed.data.status ?? "draft"
    }
  });

  await writeAuditLog(session.userId, "template.create", "mail_template", { templateId: template.id });
  return NextResponse.json({ ok: true, template });
}
