import { prisma } from "@nexus/db";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { PerformanceAnalytics } from "@/components/dashboard/performance-analytics";
import { QueueObservabilityWidget } from "@/components/dashboard/queue-observability-widget";
import { SmtpHealthSummary } from "@/components/dashboard/smtp-health-summary";
import { LiveSmtpFlowCard } from "@/components/smtp/live-smtp-flow-card";
import { PageHeader } from "@/components/ui/page-header";
import { getQueueObservability } from "@/server/observability/queue-observability.service";

export const dynamic = "force-dynamic";

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

type SmtpSummary = {
  id: string;
  name: string;
  isThrottled: boolean;
  throttleReason: string | null;
  providerLabel: string | null;
};

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<{ analyticsRange?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const analyticsRange = params.analyticsRange === "today" || params.analyticsRange === "30d" ? params.analyticsRange : "7d";
  const dayStart = startOfToday();
  const analyticsStart = new Date();
  if (analyticsRange === "today") {
    analyticsStart.setHours(0, 0, 0, 0);
  } else if (analyticsRange === "30d") {
    analyticsStart.setDate(analyticsStart.getDate() - 29);
    analyticsStart.setHours(0, 0, 0, 0);
  } else {
    analyticsStart.setDate(analyticsStart.getDate() - 6);
    analyticsStart.setHours(0, 0, 0, 0);
  }
  const [
    templates,
    lists,
    recipients,
    campaigns,
    sentToday,
    failedToday,
    opensToday,
    clicksToday,
    analyticsLogs,
    analyticsOpenEvents,
    analyticsClickEvents,
    smtpStates,
    smtpTotalCount,
    smtpHealthyCount,
    smtpThrottledCount,
    smtpErrorCount
  ] = await Promise.all([
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
    prisma.campaignLog.findMany({
      where: {
        createdAt: { gte: analyticsStart },
        OR: [{ eventType: "sent" }, { status: "failed" }, { status: "skipped" }]
      },
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        eventType: true,
        status: true,
        providerCode: true,
        message: true
      }
    }),
    prisma.openEvent.findMany({
      where: { createdAt: { gte: analyticsStart } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    }),
    prisma.clickEvent.findMany({
      where: { createdAt: { gte: analyticsStart } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    }),
    prisma.smtpAccount.findMany({
      where: { isSoftDeleted: false },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, isThrottled: true, throttleReason: true, providerLabel: true }
    }) as Promise<SmtpSummary[]>,
    prisma.smtpAccount.count({ where: { isSoftDeleted: false } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isThrottled: false } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isThrottled: true } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, healthStatus: "error" } })
  ]);
  const queueMetrics = await getQueueObservability().catch(() => null);

  const bucketKeys: string[] = [];
  if (analyticsRange === "today") {
    for (let hour = 0; hour < 24; hour += 1) {
      bucketKeys.push(String(hour).padStart(2, "0"));
    }
  } else {
    const days = analyticsRange === "30d" ? 30 : 7;
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      bucketKeys.push(date.toISOString().slice(0, 10));
    }
  }
  const labelForKey = (key: string) => {
    if (analyticsRange === "today") return `${key}:00`;
    const parsed = new Date(`${key}T00:00:00`);
    return analyticsRange === "30d"
      ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : parsed.toLocaleDateString("en-US", { weekday: "short" });
  };
  const keyForDate = (date: Date) => {
    if (analyticsRange === "today") return String(date.getHours()).padStart(2, "0");
    return date.toISOString().slice(0, 10);
  };

  const trendMap = new Map<string, { sent: number; failed: number; skipped: number; opens: number; clicks: number }>();
  for (const key of bucketKeys) {
    trendMap.set(key, { sent: 0, failed: 0, skipped: 0, opens: 0, clicks: 0 });
  }

  const failureReasonMap = new Map<string, number>();
  for (const log of analyticsLogs as Array<{ createdAt: Date; eventType: string; status: string; providerCode: string | null; message: string | null }>) {
    const key = keyForDate(new Date(log.createdAt));
    const current = trendMap.get(key);
    if (current) {
      if (log.eventType === "sent") current.sent += 1;
      if (log.status === "failed") current.failed += 1;
      if (log.status === "skipped") current.skipped += 1;
    }
    if (log.status === "failed") {
      const reason = (log.providerCode ?? log.message ?? "delivery_failed").slice(0, 48);
      failureReasonMap.set(reason, (failureReasonMap.get(reason) ?? 0) + 1);
    }
  }
  for (const row of analyticsOpenEvents as Array<{ createdAt: Date }>) {
    const key = keyForDate(new Date(row.createdAt));
    const current = trendMap.get(key);
    if (current) current.opens += 1;
  }
  for (const row of analyticsClickEvents as Array<{ createdAt: Date }>) {
    const key = keyForDate(new Date(row.createdAt));
    const current = trendMap.get(key);
    if (current) current.clicks += 1;
  }

  const deliveryData = bucketKeys.map((key) => {
    const row = trendMap.get(key) ?? { sent: 0, failed: 0, skipped: 0, opens: 0, clicks: 0 };
    return {
      label: labelForKey(key),
      sent: row.sent,
      failed: row.failed,
      skipped: row.skipped
    };
  });
  const engagementData = bucketKeys.map((key) => {
    const row = trendMap.get(key) ?? { sent: 0, failed: 0, skipped: 0, opens: 0, clicks: 0 };
    const openRate = row.sent > 0 ? Number(((row.opens / row.sent) * 100).toFixed(2)) : 0;
    const clickRate = row.sent > 0 ? Number(((row.clicks / row.sent) * 100).toFixed(2)) : 0;
    return {
      label: labelForKey(key),
      opens: row.opens,
      clicks: row.clicks,
      openRate,
      clickRate
    };
  });
  const totalFailures = Array.from(failureReasonMap.values()).reduce((sum, value) => sum + value, 0);
  const failureData = Array.from(failureReasonMap.entries())
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: totalFailures > 0 ? Number(((count / totalFailures) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.count - a.count);

  const smtpTotals = {
    total: smtpTotalCount,
    healthy: smtpHealthyCount,
    throttled: smtpThrottledCount,
    error: smtpErrorCount
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kontrol Merkezi"
        description="Canli kuyruk, SMTP sagligi ve kampanya aktivitesini tek bakista izleyin."
        action={
          <div className="rounded-xl border border-border bg-zinc-900/70 px-3 py-2 text-xs text-zinc-300">
            Kuyruk: aktif {queueMetrics?.deliveryCounts?.active ?? 0} · bekleyen {queueMetrics?.deliveryCounts?.waiting ?? 0}
          </div>
        }
      />

      <MetricsCards
        templates={templates}
        lists={lists}
        recipients={recipients}
        campaigns={campaigns}
        sentToday={sentToday}
        failedToday={failedToday}
        opensToday={opensToday}
        clicksToday={clicksToday}
      />

      <PerformanceAnalytics
        deliveryData={deliveryData}
        engagementData={engagementData}
        failureData={failureData}
        range={analyticsRange}
      />

      <section>
        <LiveSmtpFlowCard />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <QueueObservabilityWidget />
        </div>
        <div className="space-y-4 xl:col-span-2">
          <SmtpHealthSummary smtpTotals={smtpTotals} smtpStates={smtpStates} />
        </div>
      </section>
    </div>
  );
}
