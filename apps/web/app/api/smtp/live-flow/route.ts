import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { getQueueObservability } from "@/server/observability/queue-observability.service";

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

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dayStart = startOfToday();
  const minuteAgo = oneMinuteAgo();
  const [queueObs, activeCampaigns, sentLastMinute, failedLastMinute, activeSmtps, warmupRows, recentLogs] =
    await Promise.all([
      getQueueObservability().catch(() => null),
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
        select: {
          id: true,
          fromEmail: true,
          isThrottled: true,
          healthStatus: true
        }
      }),
      prisma.smtpWarmupStat.findMany({
        where: { date: { gte: dayStart } },
        select: {
          smtpAccountId: true,
          successfulDeliveries: true,
          failedDeliveries: true,
          updatedAt: true
        }
      }),
      prisma.campaignLog.findMany({
        where: {
          OR: [{ eventType: "sent" }, { status: "failed" }]
        },
        orderBy: { createdAt: "desc" },
        take: 20,
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
    ]);

  const throughputBySmtp = (queueObs?.throughputBySmtp ?? []) as Array<{
    smtpAccountId: string;
    sentLastMinute: number;
  }>;
  const throughputMap = new Map<string, number>(
    throughputBySmtp.map((item) => [item.smtpAccountId, Number(item.sentLastMinute ?? 0)])
  );
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

  const smtpActivity = activeSmtps.map((smtp) => {
    const warm = warmupMap.get(smtp.id);
    const sentPerMinute = Number(throughputMap.get(smtp.id) ?? 0);
    const status =
      smtp.healthStatus === "error" ? "unhealthy" : smtp.isThrottled ? "throttled" : "active";
    return {
      smtpId: smtp.id,
      fromEmail: smtp.fromEmail,
      status,
      sentToday: Number(warm?.successfulDeliveries ?? 0),
      failedToday: Number(warm?.failedDeliveries ?? 0),
      currentRps: Number((sentPerMinute / 60).toFixed(3)),
      lastUsedAt: warm?.updatedAt ?? null
    };
  });

  const recentEvents = recentLogs.map((log) => {
    const metadata = (log.metadata ?? {}) as { smtpAccountId?: string };
    const smtpFromEmail =
      activeSmtps.find((smtp) => smtp.id === metadata.smtpAccountId)?.fromEmail ??
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

  const queuePending = Number(queueObs?.deliveryCounts?.waiting ?? queueObs?.deliveryCounts?.wait ?? 0);
  const queueProcessing = Number(queueObs?.deliveryCounts?.active ?? 0);
  const currentRps = Number((sentLastMinute / 60).toFixed(3));

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
    smtpActivity,
    recentEvents
  });
}
