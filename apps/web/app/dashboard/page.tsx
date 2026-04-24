import { BarChart3, CheckCircle2, FileText, ListChecks, Mail, MousePointerClick, Send, TriangleAlert, Users } from "lucide-react";
import { prisma } from "@nexus/db";
import { DeliveryChart } from "@/components/dashboard/delivery-chart";
import { PerformanceCharts } from "@/components/dashboard/performance-charts";
import { QueueObservabilityWidget } from "@/components/dashboard/queue-observability-widget";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
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

type RecentActivityLog = {
  id: string;
  createdAt: Date;
  eventType: string;
  status: string;
  message: string | null;
  campaign: { name: string } | null;
};

export default async function DashboardPage() {
  const dayStart = startOfToday();
  const [
    templates,
    lists,
    recipients,
    campaigns,
    sentToday,
    failedToday,
    opensToday,
    clicksToday,
    recentLogs,
    recentFailedLogs,
    smtpStates
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
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { campaign: { select: { name: true } } }
    }) as Promise<RecentActivityLog[]>,
    prisma.campaignLog.findMany({
      where: {
        createdAt: { gte: dayStart },
        OR: [{ eventType: "sent" }, { status: "failed" }]
      },
      orderBy: { createdAt: "desc" },
      take: 300
    }),
    prisma.smtpAccount.findMany({
      where: { isSoftDeleted: false },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, name: true, isThrottled: true, throttleReason: true, providerLabel: true }
    }) as Promise<SmtpSummary[]>
  ]);
  const queueMetrics = await getQueueObservability().catch(() => null);

  const deliveryHourMap = new Map<string, { sent: number; failed: number }>();
  for (let hour = 0; hour < 24; hour += 1) {
    const key = String(hour).padStart(2, "0");
    deliveryHourMap.set(key, { sent: 0, failed: 0 });
  }
  for (const log of recentFailedLogs) {
    const key = String(new Date(log.createdAt).getHours()).padStart(2, "0");
    const existing = deliveryHourMap.get(key);
    if (!existing) continue;
    if (log.eventType === "sent") existing.sent += 1;
    if (log.status === "failed") existing.failed += 1;
  }
  const deliveryChartData = Array.from(deliveryHourMap.entries())
    .map(([hour, val]) => ({ hour, sent: val.sent, failed: val.failed }))
    .filter((item) => item.sent > 0 || item.failed > 0);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const campaignsWeek = await prisma.campaign.findMany({
    where: { createdAt: { gte: weekStart } },
    select: { createdAt: true, openRate: true, clickRate: true, totalFailed: true, throttleReason: true }
  });

  const dayMap = new Map<string, { openRate: number; clickRate: number; count: number }>();
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    const key = day.toLocaleDateString("en-US", { weekday: "short" });
    dayMap.set(key, { openRate: 0, clickRate: 0, count: 0 });
  }
  for (const campaign of campaignsWeek) {
    const key = new Date(campaign.createdAt).toLocaleDateString("en-US", { weekday: "short" });
    const existing = dayMap.get(key);
    if (!existing) continue;
    existing.openRate += campaign.openRate ?? 0;
    existing.clickRate += campaign.clickRate ?? 0;
    existing.count += 1;
  }
  const rateData = Array.from(dayMap.entries()).map(([day, val]) => ({
    day,
    openRate: val.count === 0 ? 0 : Number((val.openRate / val.count).toFixed(2)),
    clickRate: val.count === 0 ? 0 : Number((val.clickRate / val.count).toFixed(2))
  }));

  const failureReasonMap = new Map<string, number>();
  for (const item of campaignsWeek) {
    if (!item.totalFailed || item.totalFailed <= 0) continue;
    const reason = item.throttleReason?.split(",")[0]?.trim() || "delivery-failed";
    failureReasonMap.set(reason, (failureReasonMap.get(reason) ?? 0) + item.totalFailed);
  }
  const failureData = Array.from(failureReasonMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const stats = [
    { label: "Templates", value: templates, icon: FileText, tone: "info" as const },
    { label: "Lists", value: lists, icon: ListChecks, tone: "info" as const },
    { label: "Recipients", value: recipients, icon: Users, tone: "info" as const },
    { label: "Campaigns", value: campaigns, icon: Mail, tone: "info" as const },
    { label: "Sent Today", value: sentToday, icon: Send, tone: "success" as const },
    { label: "Failed Today", value: failedToday, icon: TriangleAlert, tone: "danger" as const },
    { label: "Opens Today", value: opensToday, icon: CheckCircle2, tone: "success" as const },
    { label: "Clicks Today", value: clicksToday, icon: MousePointerClick, tone: "warning" as const }
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Command Center"
        description="Canli queue, SMTP sagligi ve kampanya aktivitesi tek bakista."
        action={
          <div className="rounded-xl border border-border bg-zinc-900/70 px-3 py-2 text-xs text-zinc-300">
            Queue: active {queueMetrics?.deliveryCounts?.active ?? 0} · waiting {queueMetrics?.deliveryCounts?.waiting ?? 0}
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

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          <DeliveryChart chartData={deliveryChartData} />
          <PerformanceCharts rateData={rateData} failureData={failureData} />
        </div>

        <div className="space-y-4">
          <QueueObservabilityWidget />
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-medium text-zinc-200">SMTP Health</h3>
            </div>
            <div className="space-y-2">
              {smtpStates.length === 0 ? (
                <EmptyState
                  icon="chart-bar"
                  title="SMTP account bulunamadi"
                  description="SMTP hesaplari eklendiginde saglik ve throttle durumu burada gorunecek."
                />
              ) : (
                smtpStates.map((smtp: SmtpSummary) => (
                  <div key={smtp.id} className="rounded-xl border border-border bg-zinc-900/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{smtp.name}</p>
                      <StatusBadge
                        label={smtp.isThrottled ? "throttled" : "healthy"}
                        tone={smtp.isThrottled ? "warning" : "success"}
                      />
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      Provider: {smtp.providerLabel ?? "custom"} · {smtp.throttleReason ?? "No active throttle"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-200">Recent Activity</h3>
        {recentLogs.length === 0 ? (
          <EmptyState
            icon="chart-bar"
            title="Aktivite kaydi yok"
            description="Kampanya islemleri basladiginda son event'ler burada listelenecek."
          />
        ) : (
          <div className="space-y-2">
            {recentLogs.map((log: RecentActivityLog) => (
              <div key={log.id} className="rounded-xl border border-border bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300">
                <span className="text-zinc-400">{new Date(log.createdAt).toLocaleString()} · </span>
                <span className="font-medium text-zinc-100">{log.campaign?.name ?? "Campaign"}</span>
                <span className="mx-1">·</span>
                <span>{log.eventType}</span>
                <span className="mx-1">·</span>
                <span className={log.status === "failed" ? "text-rose-300" : "text-emerald-300"}>{log.status}</span>
                {log.message ? <span className="mx-1 text-zinc-500">— {log.message}</span> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
