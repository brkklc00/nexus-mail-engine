"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { PageHeader } from "@/components/ui/page-header";

const LiveSmtpFlowCard = dynamic(
  () => import("@/components/smtp/live-smtp-flow-card").then((mod) => mod.LiveSmtpFlowCard),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-2xl border border-border bg-card p-4 text-sm text-zinc-400">
        Canlı SMTP akışı yükleniyor...
      </section>
    )
  }
);

const QueueObservabilityWidget = dynamic(
  () => import("@/components/dashboard/queue-observability-widget").then((mod) => mod.QueueObservabilityWidget),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-2xl border border-border bg-card p-4 text-sm text-zinc-400">
        Kuyruk gözlemlenebilirliği yükleniyor...
      </section>
    )
  }
);

const SmtpHealthWidget = dynamic(
  () => import("@/components/dashboard/smtp-health-widget").then((mod) => mod.SmtpHealthWidget),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-2xl border border-border bg-card p-4 text-sm text-zinc-400">
        SMTP sağlığı yükleniyor...
      </section>
    )
  }
);

const PerformanceAnalyticsWidget = dynamic(
  () => import("@/components/dashboard/performance-analytics-widget").then((mod) => mod.PerformanceAnalyticsWidget),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-2xl border border-border bg-card p-4 text-sm text-zinc-400">
        Performans analitiği yükleniyor...
      </section>
    )
  }
);

type SummaryPayload = {
  ok: boolean;
  templates: number;
  lists: number;
  recipients: number;
  campaigns: number;
  sentToday: number;
  failedToday: number;
  opensToday: number;
  clicksToday: number;
  queue: {
    campaign?: Record<string, number>;
    delivery?: Record<string, number>;
    retry?: Record<string, number>;
    dead?: Record<string, number>;
  };
  error?: string;
};

const HUGE_QUEUE_THRESHOLD = 100_000;

export function DashboardOverview() {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);

    const pull = async () => {
      try {
        const response = await fetch("/api/dashboard/summary", {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as SummaryPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Yüklenemedi");
        }
        if (mounted) {
          setSummary(payload);
          setSummaryError(null);
        }
      } catch {
        if (mounted) {
          setSummaryError("Yüklenemedi");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void pull();
    return () => {
      mounted = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  const queuePending = useMemo(() => {
    if (!summary) {
      return 0;
    }
    return Number(summary.queue.delivery?.waiting ?? summary.queue.delivery?.wait ?? 0) + Number(summary.queue.retry?.waiting ?? summary.queue.retry?.wait ?? 0);
  }, [summary]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kontrol Merkezi"
        description="Canlı kuyruk, SMTP sağlığı ve kampanya aktivitesini tek bakışta izleyin."
        action={
          summary ? (
            <div className="rounded-xl border border-border bg-zinc-900/70 px-3 py-2 text-xs text-zinc-300">
              Kuyruk: aktif {Number(summary.queue.delivery?.active ?? 0)} · bekleyen {queuePending}
            </div>
          ) : (
            <div className="h-9 w-48 animate-pulse rounded-xl border border-border bg-zinc-900/70" />
          )
        }
      />

      {summaryError ? (
        <section className="rounded-2xl border border-border bg-card p-4 text-sm text-rose-300">{summaryError}</section>
      ) : summary ? (
        <MetricsCards
          templates={summary.templates}
          lists={summary.lists}
          recipients={summary.recipients}
          campaigns={summary.campaigns}
          sentToday={summary.sentToday}
          failedToday={summary.failedToday}
          opensToday={summary.opensToday}
          clicksToday={summary.clicksToday}
        />
      ) : (
        <SummarySkeleton />
      )}

      {queuePending >= HUGE_QUEUE_THRESHOLD ? (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Kuyruk çok büyük, detaylar arka planda yükleniyor.
        </section>
      ) : null}

      <PerformanceAnalyticsWidget />

      <section>
        <LiveSmtpFlowCard />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <QueueObservabilityWidget />
        </div>
        <div className="space-y-4 xl:col-span-2">
          <SmtpHealthWidget />
        </div>
      </section>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-2xl border border-border bg-zinc-900/70" />
      ))}
    </section>
  );
}
