import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { deliveryQueue, retryQueue } from "@nexus/queue";
import { getSession } from "@/server/auth/session";

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function oneMinuteAgo() {
  return new Date(Date.now() - 60_000);
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return "-";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

type WarmupRow = {
  smtpAccountId: string;
  successfulDeliveries: number | null;
  failedDeliveries: number | null;
  updatedAt: Date | null;
};

type ActiveSmtpRow = {
  id: string;
  fromEmail: string | null;
  isThrottled: boolean | null;
  healthStatus: string | null;
};

type RecentLogRow = {
  createdAt: Date;
  eventType: string;
  status: string;
  message: string | null;
  metadata: unknown;
  campaign: {
    name: string;
    smtpAccount: { fromEmail: string | null } | null;
  } | null;
  recipient: { email: string | null } | null;
};

const RECENT_EVENTS_LIMIT = 20;
const SMTP_ACTIVITY_LIMIT = 20;
const HUGE_QUEUE_THRESHOLD = 100_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function GET() {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dayStart = startOfToday();
  const minuteAgo = oneMinuteAgo();
  try {
    const [deliveryCounts, retryCounts, activeCampaigns, sentLastMinute, failedLastMinute, activeSmtps, recentLogs] =
      await withTimeout(
        Promise.all([
          deliveryQueue.getJobCounts(),
          retryQueue.getJobCounts(),
          prisma.campaign.count({ where: { status: { in: ["queued", "running"] } } }),
          prisma.campaignLog.count({
            where: {
              eventType: "sent",
              createdAt: { gte: minuteAgo }
            }
          }),
          prisma.campaignLog.count({
            where: {
              status: "failed",
              createdAt: { gte: minuteAgo }
            }
          }),
          prisma.smtpAccount.findMany({
            where: { isActive: true, isSoftDeleted: false },
            orderBy: { updatedAt: "desc" },
            take: SMTP_ACTIVITY_LIMIT,
            select: {
              id: true,
              fromEmail: true,
              isThrottled: true,
              healthStatus: true
            }
          }),
          prisma.campaignLog.findMany({
            where: {
              OR: [{ eventType: "sent" }, { status: "failed" }]
            },
            orderBy: { createdAt: "desc" },
            take: RECENT_EVENTS_LIMIT,
            select: {
              createdAt: true,
              eventType: true,
              status: true,
              message: true,
              metadata: true,
              campaign: {
                select: {
                  name: true,
                  smtpAccount: { select: { fromEmail: true } }
                }
              },
              recipient: { select: { email: true } }
            }
          })
        ]),
        3000
      );

    const smtpIds = (activeSmtps as ActiveSmtpRow[]).map((smtp) => smtp.id);
    const warmupRows = smtpIds.length
      ? ((await prisma.smtpWarmupStat
          .findMany({
            where: { date: { gte: dayStart }, smtpAccountId: { in: smtpIds } },
            select: {
              smtpAccountId: true,
              successfulDeliveries: true,
              failedDeliveries: true,
              updatedAt: true
            },
            take: SMTP_ACTIVITY_LIMIT
          })
          .catch((error: unknown) => {
            console.warn("[smtp.live-flow] warmup query skipped", {
              message: error instanceof Error ? error.message : String(error)
            });
            return [];
          })) as WarmupRow[])
      : [];

    const warmupMap = new Map<
      string,
      { successfulDeliveries: number; failedDeliveries: number; updatedAt: string | null }
    >(
      warmupRows.map((row) => [
        row.smtpAccountId,
        {
          successfulDeliveries: Number(row.successfulDeliveries ?? 0),
          failedDeliveries: Number(row.failedDeliveries ?? 0),
          updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null
        }
      ])
    );

    const smtpActivity = (activeSmtps as ActiveSmtpRow[]).map((smtp) => {
      const warm = warmupMap.get(smtp.id);
      const status =
        smtp.healthStatus === "error" ? "unhealthy" : smtp.isThrottled ? "throttled" : "active";
      return {
        smtpId: smtp.id,
        fromEmail: smtp.fromEmail,
        status,
        sentToday: Number(warm?.successfulDeliveries ?? 0),
        failedToday: Number(warm?.failedDeliveries ?? 0),
        currentRps: Number((sentLastMinute / 60).toFixed(3)),
        lastUsedAt: warm?.updatedAt ?? null
      };
    });

    const smtpById = new Map((activeSmtps as ActiveSmtpRow[]).map((smtp) => [smtp.id, smtp.fromEmail]));
    const recentEvents = (recentLogs as RecentLogRow[]).map((log) => {
      const metadata = (log.metadata ?? {}) as { smtpAccountId?: string };
      const smtpFromEmail =
        smtpById.get(String(metadata.smtpAccountId ?? "")) ??
        log.campaign?.smtpAccount?.fromEmail ??
        "-";
      const isSuccess = log.eventType === "sent" && log.status !== "failed";
      return {
        time: log.createdAt.toISOString(),
        campaignName: log.campaign?.name ?? "Campaign",
        smtpFromEmail,
        recipientEmail: maskEmail(log.recipient?.email),
        status: isSuccess ? "success" : "failed",
        error: isSuccess ? null : log.message ?? "delivery_failed"
      };
    });

    const queuePending =
      Number(deliveryCounts.waiting ?? deliveryCounts.wait ?? 0) +
      Number(retryCounts.waiting ?? retryCounts.wait ?? 0);
    const queueProcessing = Number(deliveryCounts.active ?? 0) + Number(retryCounts.active ?? 0);
    const currentRps = Number((sentLastMinute / 60).toFixed(3));
    const queueHuge = queuePending >= HUGE_QUEUE_THRESHOLD;

    console.info("[smtp.live-flow] completed", { ms: Date.now() - startedAt });

    return NextResponse.json({
      ok: true,
      metrics: {
        currentRps,
        sentLastMinute,
        failedLastMinute,
        queuePending,
        queueProcessing,
        activeCampaigns
      },
      queueCounts: {
        delivery: deliveryCounts,
        retry: retryCounts
      },
      queueHuge,
      smtpActivity,
      recentEvents
    });
  } catch (error) {
    console.warn("[dashboard.widget] slow", { widget: "smtp_live_flow", ms: Date.now() - startedAt });
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Yüklenemedi",
      metrics: {
        currentRps: 0,
        sentLastMinute: 0,
        failedLastMinute: 0,
        queuePending: 0,
        queueProcessing: 0,
        activeCampaigns: 0
      },
      queueHuge: false,
      smtpActivity: [],
      recentEvents: []
    });
  }
}
