import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

type ExportFormat = "txt" | "csv";
type ExportScope = "all" | "filtered" | "selected";

function normalizeDateRange(range: string | null, startDate: string | null, endDate: string | null) {
  const now = new Date();
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { gte: start, lte: now };
  }
  if (range === "7d") {
    return { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), lte: now };
  }
  if (range === "30d") {
    return { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), lte: now };
  }
  if (range === "custom" && (startDate || endDate)) {
    return {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate ? { lte: new Date(endDate) } : {})
    };
  }
  return undefined;
}

function buildWhere(url: URL, scope: ExportScope) {
  const reason = (url.searchParams.get("reason") ?? "").trim();
  const source = (url.searchParams.get("source") ?? "").trim();
  const q = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const filterScope = (url.searchParams.get("scopeFilter") ?? "all").trim();
  const dateRange = (url.searchParams.get("dateRange") ?? "all").trim();
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const dateFilter = normalizeDateRange(dateRange, startDate, endDate);

  const base = {
    ...(q ? { emailNormalized: { contains: q } } : {}),
    ...(reason && reason !== "all" ? { reason: { equals: reason, mode: "insensitive" as const } } : {}),
    ...(source && source !== "all" ? { source: { equals: source, mode: "insensitive" as const } } : {}),
    ...(filterScope !== "all" ? { scope: filterScope } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {})
  };
  if (scope === "selected") {
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return { ...base, id: { in: ids.length > 0 ? ids : ["__none__"] } };
  }
  if (scope === "filtered") return base;
  return {};
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const format = ((url.searchParams.get("format") ?? "txt").toLowerCase() as ExportFormat);
  const scope = ((url.searchParams.get("scope") ?? "all").toLowerCase() as ExportScope);
  const where = buildWhere(url, scope);

  const encoder = new TextEncoder();
  const filename = `suppression-export-${new Date().toISOString().slice(0, 10)}.${format}`;
  let cursorId = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (format === "csv") {
        controller.enqueue(encoder.encode("email,reason,source,scope,createdAt\n"));
      }
      while (true) {
        const rows = await prisma.suppressionEntry.findMany({
          where: {
            ...where,
            ...(cursorId ? { id: { gt: cursorId } } : {})
          },
          orderBy: { id: "asc" },
          take: 2000,
          select: {
            id: true,
            email: true,
            reason: true,
            source: true,
            scope: true,
            createdAt: true
          }
        });
        if (rows.length === 0) break;
        const lines = rows.map((row: { email: string; reason: string; source: string | null; scope: string; createdAt: Date }) => {
          if (format === "txt") {
            return row.email;
          }
          const sourceValue = row.source ?? "";
          return `${row.email},${row.reason},${sourceValue},${row.scope},${row.createdAt.toISOString()}`;
        });
        controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
        cursorId = rows[rows.length - 1].id;
      }
      controller.close();
    }
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
