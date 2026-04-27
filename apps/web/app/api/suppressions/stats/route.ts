import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalSuppressed,
    invalidAddress,
    hardBounce,
    complaint,
    blockedRejected,
    manual,
    alibabaSynced,
    addedToday,
    addedLast7Days,
    alibabaLastSync
  ] = await Promise.all([
    prisma.suppressionEntry.count(),
    prisma.suppressionEntry.count({ where: { reason: { contains: "invalid", mode: "insensitive" } } }),
    prisma.suppressionEntry.count({
      where: {
        OR: [
          { reason: { contains: "hard bounce", mode: "insensitive" } },
          { reason: { contains: "hard_bounce", mode: "insensitive" } },
          { reason: { contains: "bounce", mode: "insensitive" } }
        ]
      }
    }),
    prisma.suppressionEntry.count({ where: { reason: { contains: "complaint", mode: "insensitive" } } }),
    prisma.suppressionEntry.count({
      where: {
        OR: [
          { reason: { contains: "blocked", mode: "insensitive" } },
          { reason: { contains: "reject", mode: "insensitive" } }
        ]
      }
    }),
    prisma.suppressionEntry.count({
      where: {
        OR: [
          { source: { contains: "manual", mode: "insensitive" } },
          { reason: { contains: "manual", mode: "insensitive" } }
        ]
      }
    }),
    prisma.suppressionEntry.count({
      where: {
        OR: [{ source: "alibaba_sync" }, { source: "alibaba" }, { reason: { startsWith: "alibaba_" } }]
      }
    }),
    prisma.suppressionEntry.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.suppressionEntry.count({ where: { createdAt: { gte: last7d } } }),
    prisma.suppressionEntry.findFirst({
      where: {
        OR: [{ source: "alibaba_sync" }, { source: "alibaba" }, { reason: { startsWith: "alibaba_" } }]
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    })
  ]);

  return NextResponse.json({
    ok: true,
    stats: {
      totalSuppressed,
      invalidAddress,
      hardBounce,
      complaint,
      blockedRejected,
      manual,
      alibabaSynced,
      addedToday,
      addedLast7Days,
      lastSyncTime: alibabaLastSync?.createdAt?.toISOString() ?? null
    }
  });
}
