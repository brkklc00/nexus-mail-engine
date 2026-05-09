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
    alibabaLastSyncEntry,
    alibabaSyncStateRow
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
        OR: [
          { source: { equals: "alibaba", mode: "insensitive" } },
          { source: { equals: "alibaba_query_invalid_address", mode: "insensitive" } },
          { source: { equals: "alibaba_invalid_address", mode: "insensitive" } },
          { source: { startsWith: "alibaba", mode: "insensitive" } }
        ]
      }
    }),
    prisma.suppressionEntry.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.suppressionEntry.count({ where: { createdAt: { gte: last7d } } }),
    prisma.suppressionEntry.findFirst({
      where: {
        OR: [
          { source: { equals: "alibaba", mode: "insensitive" } },
          { source: { equals: "alibaba_query_invalid_address", mode: "insensitive" } },
          { source: { equals: "alibaba_invalid_address", mode: "insensitive" } },
          { source: { startsWith: "alibaba", mode: "insensitive" } }
        ]
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    }),
    prisma.appSetting.findUnique({
      where: { key: "alibaba_sync_state_v1" },
      select: { value: true }
    })
  ]);

  const syncState = (alibabaSyncStateRow?.value as any) ?? null;
  const syncUpdatedAt =
    typeof syncState?.completedAt === "string"
      ? syncState.completedAt
      : typeof syncState?.updatedAt === "string"
        ? syncState.updatedAt
        : null;
  const lastSyncTime = syncUpdatedAt ?? alibabaLastSyncEntry?.createdAt?.toISOString() ?? null;

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
      lastSyncTime
    }
  });
}
