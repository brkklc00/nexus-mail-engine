import { BarChart3, CheckCircle2, FileText, ListChecks, Mail, MousePointerClick, Send, TriangleAlert, Users } from "lucide-react";
import { prisma } from "@nexus/db";
import { PerformanceCharts } from "@/components/dashboard/performance-charts";
import { QueueObservabilityWidget } from "@/components/dashboard/queue-observability-widget";
import { LiveSmtpFlowCard } from "@/components/smtp/live-smtp-flow-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getQueueObservability } from "@/server/observability/queue-observability.service";
import Link from "next/link";

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
  const smtpPreviewLimit = 5;
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
      take: smtpPreviewLimit,
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

  const stats = [
    { label: "Sablonlar", value: templates, icon: FileText, tone: "info" as const },
    { label: "Listeler", value: lists, icon: ListChecks, tone: "info" as const },
    { label: "Alicilar", value: recipients, icon: Users, tone: "info" as const },
    { label: "Kampanyalar", value: campaigns, icon: Mail, tone: "info" as const },
    { label: "Bugun Gonderilen", value: sentToday, icon: Send, tone: "success" as const },
    { label: "Bugun Basarisiz", value: failedToday, icon: TriangleAlert, tone: "danger" as const },
    { label: "Bugun Acilma", value: opensToday, icon: CheckCircle2, tone: "success" as const },
    { label: "Bugun Tiklama", value: clicksToday, icon: MousePointerClick, tone: "warning" as const }
  ];

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

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((metric) => (
          <article
            key={metric.label}
            className="rounded-2xl border border-border bg-gradient-to-br from-card to-zinc-900/70 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-indigo-400/40"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-zinc-400">{metric.label}</p>
              <metric.icon className="h-4 w-4 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">{metric.value.toLocaleString()}</p>
            <StatusBadge label={metric.tone} tone={metric.tone} className="mt-3" />
          </article>
        ))}
      </section>

      <PerformanceCharts
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
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-zinc-400" />
                <h3 className="text-sm font-medium text-zinc-200">SMTP Sagligi</h3>
              </div>
              <Link href="/settings/smtp" className="rounded border border-border px-2 py-1 text-xs text-zinc-300">
                Tum SMTP'leri gor
              </Link>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-zinc-300">Toplam: {smtpTotals.total}</div>
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-emerald-300">Saglikli: {smtpTotals.healthy}</div>
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-amber-300">Sinirlandi: {smtpTotals.throttled}</div>
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-rose-300">Hata: {smtpTotals.error}</div>
            </div>
            <div className="space-y-2">
              {smtpStates.length === 0 ? (
                <EmptyState
                  icon="chart-bar"
                  title="SMTP hesabi bulunamadi"
                  description="Hesaplar eklendikten sonra SMTP saglik ve sinirlama durumu burada gorunur."
                />
              ) : (
                smtpStates.slice(0, smtpPreviewLimit).map((smtp: SmtpSummary) => (
                  <div key={smtp.id} className="rounded-xl border border-border bg-zinc-900/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{smtp.name}</p>
                      <StatusBadge
                        label={smtp.isThrottled ? "throttled" : "healthy"}
                        tone={smtp.isThrottled ? "warning" : "success"}
                      />
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      Saglayici: {smtp.providerLabel ?? "ozel"} · {smtp.throttleReason ?? "Aktif sinirlama yok"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
