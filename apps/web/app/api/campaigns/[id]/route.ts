import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      template: true,
      smtpAccount: true,
      list: { select: { id: true, name: true } },
      segment: { select: { id: true, name: true } },
      logs: { orderBy: { createdAt: "desc" }, take: 30 }
    }
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const [topLinkGroups, totalClicks, uniqueClicks, failedGroups, skippedSuppression] = await Promise.all([
    prisma.clickEvent.groupBy({
      by: ["campaignLinkId"],
      where: { campaignId: id, campaignLinkId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { campaignLinkId: "desc" } },
      take: 5
    }),
    prisma.clickEvent.count({ where: { campaignId: id } }),
    prisma.clickEvent.groupBy({ by: ["recipientId"], where: { campaignId: id } }),
    prisma.campaignLog.groupBy({
      by: ["eventType"],
      where: { campaignId: id, status: "failed" },
      _count: { _all: true },
      orderBy: { _count: { eventType: "desc" } },
      take: 10
    }),
    prisma.campaignLog.count({
      where: {
        campaignId: id,
        status: "skipped",
        OR: [{ eventType: { contains: "suppression", mode: "insensitive" } }, { message: { contains: "suppression", mode: "insensitive" } }]
      }
    })
  ]);

  const linkIds = topLinkGroups.map((group: any) => group.campaignLinkId).filter(Boolean);
  const links = linkIds.length
    ? await prisma.campaignLink.findMany({ where: { id: { in: linkIds as string[] } }, select: { id: true, originalUrl: true } })
    : [];
  const linkMap = new Map(links.map((link: { id: string; originalUrl: string }) => [link.id, link.originalUrl]));
  const topLinks = topLinkGroups.map((group: any) => ({
    id: group.campaignLinkId,
    url: linkMap.get(group.campaignLinkId) ?? "-",
    clicks: Number(group._count?._all ?? 0)
  }));

  const completionBase = campaign.totalTargeted || 1;
  const progress = Math.min(
    100,
    Number((((campaign.totalSent + campaign.totalFailed + campaign.totalSkipped) / completionBase) * 100).toFixed(2))
  );

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      status: campaign.status,
      provider: campaign.provider,
      createdAt: campaign.createdAt.toISOString(),
      startedAt: campaign.startedAt?.toISOString() ?? null,
      finishedAt: campaign.finishedAt?.toISOString() ?? null,
      template: campaign.template
        ? {
            id: campaign.template.id,
            title: campaign.template.title,
            subject: campaign.template.subject,
            htmlBody: campaign.template.htmlBody,
            plainTextBody: campaign.template.plainTextBody
          }
        : null,
      list: campaign.list,
      segment: campaign.segment,
      smtp: campaign.smtpAccount
        ? {
            id: campaign.smtpAccount.id,
            name: campaign.smtpAccount.name,
            host: campaign.smtpAccount.host,
            port: campaign.smtpAccount.port,
            fromEmail: campaign.smtpAccount.fromEmail
          }
        : null,
      metrics: {
        targeted: campaign.totalTargeted,
        sent: campaign.totalSent,
        failed: campaign.totalFailed,
        skipped: campaign.totalSkipped,
        opened: campaign.totalOpened,
        clicked: campaign.totalClicked,
        unsubscribed: campaign.unsubscribeCount,
        bounce: campaign.bounceCount,
        complaint: campaign.complaintCount,
        progress,
        totalClicks,
        uniqueClicks: uniqueClicks.length
      },
      failureBreakdown: failedGroups.map((group: any) => ({
        eventType: group.eventType,
        count: Number(group._count?._all ?? 0)
      })),
      skippedSummary: {
        skipped: campaign.totalSkipped,
        suppressionMatched: skippedSuppression
      },
      topLinks,
      recentLogs: campaign.logs.map((log: any) => ({
        id: log.id,
        eventType: log.eventType,
        status: log.status,
        message: log.message,
        createdAt: log.createdAt.toISOString()
      }))
    }
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { status: true }
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (!["pending", "failed", "canceled", "completed"].includes(campaign.status)) {
    return NextResponse.json({ error: "Campaign cannot be deleted in current state" }, { status: 400 });
  }

  await prisma.campaign.delete({ where: { id } });
  await writeAuditLog(session.userId, "campaign.delete", "campaign", { campaignId: id });
  return NextResponse.json({ ok: true });
}
