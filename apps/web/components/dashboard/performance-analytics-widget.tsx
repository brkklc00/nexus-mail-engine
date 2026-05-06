"use client";

import { useEffect, useState } from "react";
import { PerformanceAnalytics } from "@/components/dashboard/performance-analytics";

type PerformancePayload = {
  ok: boolean;
  range: "today" | "7d" | "30d";
  deliveryData: Array<{ label: string; sent: number; failed: number; skipped: number }>;
  engagementData: Array<{ label: string; opens: number; clicks: number; openRate: number; clickRate: number }>;
  failureData: Array<{ reason: string; count: number; percentage: number }>;
};

export function PerformanceAnalyticsWidget() {
  const [data, setData] = useState<PerformancePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = window.setTimeout(() => controller.abort(), 3000);

    const pull = async () => {
      try {
        const response = await fetch("/api/dashboard/performance?range=7d", {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as PerformancePayload & { error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Yüklenemedi");
        }
        if (Date.now() - startedAt > 2500) {
          console.warn("[dashboard.widget] slow", { widget: "performance", ms: Date.now() - startedAt });
        }
        if (mounted) {
          setData(payload);
          setError(null);
        }
      } catch {
        if (mounted) {
          setError("Yüklenemedi");
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

  if (error) {
    return <section className="rounded-2xl border border-border bg-card p-4 text-sm text-rose-300">{error}</section>;
  }

  if (!data) {
    return <section className="rounded-2xl border border-border bg-card p-4 text-sm text-zinc-400">Performans analitiği yükleniyor...</section>;
  }

  return (
    <PerformanceAnalytics
      deliveryData={data.deliveryData}
      engagementData={data.engagementData}
      failureData={data.failureData}
      range={data.range}
    />
  );
}
