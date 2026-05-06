import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { campaignQueue, deadLetterQueue, deliveryQueue, retryQueue } from "@nexus/queue";
import { getSession } from "@/server/auth/session";

type DashboardSummaryPayload = {
  templates: number;
  lists: number;
  recipients: number;
  campaigns: number;
  sentToday: number;
  failedToday: number;
  opensToday: number;
  clicksToday: number;
  queue: {
    campaign: Record<string, number>;
    delivery: Record<string, number>;
    retry: Record<string, number>;
    dead: Record<string, number>;
  };
};

const SUMMARY_CACHE_TTL_MS = 8_000;

let summaryCache: { expiresAt: number; payload: DashboardSummaryPayload } | null = null;

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function GET() {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (summaryCache && summaryCache.expiresAt > Date.now()) {
    console.info("[dashboard.summary] completed", { ms: Date.now() - startedAt, cache: "hit" });
    return NextResponse.json({ ok: true, ...summaryCache.payload, cached: true });
  }

  const dayStart = startOfToday();

  const [templates, lists, recipients, campaigns, sentToday, failedToday, opensToday, clicksToday, campaignCounts, deliveryCounts, retryCounts, deadCounts] =
    await Promise.all([
      prisma.mailTemplate.count(),
      prisma.recipientList.count(),
      prisma.recipient.count(),
      prisma.campaign.count(),
      prisma.campaignLog.count({
        where: { eventType: "sent", createdAt: { gte: dayStart } }
      }),
      prisma.campaignLog.count({
        where: { status: "failed", createdAt: { gte: dayStart } }
      }),
      prisma.openEvent.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.clickEvent.count({ where: { createdAt: { gte: dayStart } } }),
      campaignQueue.getJobCounts(),
      deliveryQueue.getJobCounts(),
      retryQueue.getJobCounts(),
      deadLetterQueue.getJobCounts()
    ]);

  const payload: DashboardSummaryPayload = {
    templates,
    lists,
    recipients,
    campaigns,
    sentToday,
    failedToday,
    opensToday,
    clicksToday,
    queue: {
      campaign: campaignCounts,
      delivery: deliveryCounts,
      retry: retryCounts,
      dead: deadCounts
    }
  };

  summaryCache = {
    payload,
    expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS
  };

  console.info("[dashboard.summary] completed", { ms: Date.now() - startedAt, cache: "miss" });

  return NextResponse.json({ ok: true, ...payload, cached: false });
}
