import { BarChart3, CheckCircle2, FileText, ListChecks, Mail, MousePointerClick, Send, TriangleAlert, Users } from "lucide-react";
import { prisma } from "@nexus/db";
import { DeliveryChart } from "@/components/dashboard/delivery-chart";
import { PerformanceCharts } from "@/components/dashboard/performance-charts";
import { QueueObservabilityWidget } from "@/components/dashboard/queue-observability-widget";
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

type RecentActivityLog = {
  id: string;
  createdAt: Date;
  eventType: string;
  status: string;
  message: string | null;
  campaign: { name: string } | null;
};

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<{ activityPage?: string; activityPageSize?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const requestedPageSize = Number(params.activityPageSize ?? 20);
  const recentPageSize = requestedPageSize === 10 ? 10 : 20;
  const requestedPage = Number(params.activityPage ?? 1);
  const recentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
  const recentSkip = (recentPage - 1) * recentPageSize;
  const smtpPreviewLimit = 5;
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
    totalRecentLogs,
    recentFailedLogs,
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
      orderBy: { createdAt: "desc" },
      skip: recentSkip,
      take: recentPageSize,
      include: { campaign: { select: { name: true } } }
    }) as Promise<RecentActivityLog[]>,
    prisma.campaignLog.count(),
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
      take: smtpPreviewLimit,
      select: { id: true, name: true, isThrottled: true, throttleReason: true, providerLabel: true }
    }) as Promise<SmtpSummary[]>,
    prisma.smtpAccount.count({ where: { isSoftDeleted: false } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isThrottled: false } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isThrottled: true } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, healthStatus: "error" } })
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

  const recentTotalPages = Math.max(1, Math.ceil(totalRecentLogs / recentPageSize));

  const smtpTotals = {
    total: smtpTotalCount,
    healthy: smtpHealthyCount,
    throttled: smtpThrottledCount,
    error: smtpErrorCount
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Command Center"
        description="Live queue, SMTP health, and campaign activity at a glance."
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-zinc-400" />
                <h3 className="text-sm font-medium text-zinc-200">SMTP Health</h3>
              </div>
              <Link href="/settings/smtp" className="rounded border border-border px-2 py-1 text-xs text-zinc-300">
                View all SMTPs
              </Link>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-zinc-300">Total: {smtpTotals.total}</div>
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-emerald-300">Healthy: {smtpTotals.healthy}</div>
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-amber-300">Throttled: {smtpTotals.throttled}</div>
              <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-rose-300">Error: {smtpTotals.error}</div>
            </div>
            <div className="space-y-2">
              {smtpStates.length === 0 ? (
                <EmptyState
                  icon="chart-bar"
                  title="No SMTP accounts found"
                  description="SMTP health and throttle state will appear here after accounts are added."
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200">Recent Activity</h3>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span>Page size:</span>
            <Link
              href={`/dashboard?activityPage=1&activityPageSize=10`}
              className={`rounded border px-2 py-1 ${recentPageSize === 10 ? "border-indigo-500/60 text-indigo-200" : "border-border text-zinc-300"}`}
            >
              10
            </Link>
            <Link
              href={`/dashboard?activityPage=1&activityPageSize=20`}
              className={`rounded border px-2 py-1 ${recentPageSize === 20 ? "border-indigo-500/60 text-indigo-200" : "border-border text-zinc-300"}`}
            >
              20
            </Link>
            <Link href="/logs" className="rounded border border-border px-2 py-1 text-zinc-300">
              Load more
            </Link>
          </div>
        </div>
        {recentLogs.length === 0 ? (
          <EmptyState
            icon="chart-bar"
            title="No activity records"
            description="Recent events will be listed here when campaign activity starts."
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
        {totalRecentLogs > recentPageSize ? (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-zinc-400">
              Page {Math.min(recentPage, recentTotalPages)} / {recentTotalPages}
            </p>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard?activityPage=${Math.max(1, recentPage - 1)}&activityPageSize=${recentPageSize}`}
                className={`rounded border px-2 py-1 text-xs ${
                  recentPage <= 1 ? "pointer-events-none border-border text-zinc-500" : "border-border text-zinc-300"
                }`}
              >
                Prev
              </Link>
              <Link
                href={`/dashboard?activityPage=${Math.min(recentTotalPages, recentPage + 1)}&activityPageSize=${recentPageSize}`}
                className={`rounded border px-2 py-1 text-xs ${
                  recentPage >= recentTotalPages ? "pointer-events-none border-border text-zinc-500" : "border-border text-zinc-300"
                }`}
              >
                Next
              </Link>
              <Link href="/logs" className="rounded border border-border px-2 py-1 text-xs text-zinc-300">
                View all ({totalRecentLogs})
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
