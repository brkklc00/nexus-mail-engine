import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

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
  const { id: listId } = await params;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const page = normalizePage(searchParams.get("page"));
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  if (!q) {
    return NextResponse.json({ ok: true, search: { query: q, page, pageSize, totalMatches: 0, rows: [] } });
  }

  const [rows, totalMatches] = await Promise.all([
    prisma.recipientListMembership.findMany({
      where: { listId, recipient: { emailNormalized: { contains: q } } },
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
    }),
    prisma.recipientListMembership.count({
      where: { listId, recipient: { emailNormalized: { contains: q } } }
    })
  ]);

  return NextResponse.json({
    ok: true,
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
