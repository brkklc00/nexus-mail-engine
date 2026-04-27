import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [templates, lists, smtps, campaigns] = await Promise.all([
    prisma.mailTemplate.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.recipientList.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        _count: {
          select: { memberships: true }
        }
      }
    }),
    prisma.smtpAccount.findMany({
      where: { isActive: true, isSoftDeleted: false },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 30 })
  ]);

  return NextResponse.json({
    templates,
    lists: lists.map((list: any) => ({
      id: list.id,
      name: list.name,
      estimatedRecipients: list._count?.memberships ?? 0
    })),
    smtps: smtps.map((smtp: any) => ({
      id: smtp.id,
      name: smtp.name,
      targetRatePerSecond: smtp.targetRatePerSecond ?? 0,
      maxRatePerSecond: smtp.maxRatePerSecond ?? null,
      isThrottled: smtp.isThrottled
    })),
    campaigns
  });
}
