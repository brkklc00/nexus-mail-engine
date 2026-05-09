"use client";

import { useEffect, useState } from "react";
import { SmtpHealthSummary } from "@/components/dashboard/smtp-health-summary";

type SmtpPayload = {
  ok: boolean;
  smtpTotals: {
    total: number;
    healthy: number;
    throttled: number;
    error: number;
  };
  smtpStates: Array<{
    id: string;
    name: string;
    isThrottled: boolean;
    throttleReason: string | null;
    providerLabel: string | null;
  }>;
  error?: string;
};

export function SmtpHealthWidget() {
  const [data, setData] = useState<SmtpPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = window.setTimeout(() => controller.abort(), 3000);

    const pull = async () => {
      try {
        const response = await fetch("/api/dashboard/smtp-health", {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as SmtpPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Yüklenemedi");
        }
        if (Date.now() - startedAt > 2500) {
          console.warn("[dashboard.widget] slow", { widget: "smtp_health", ms: Date.now() - startedAt });
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
    return <section className="h-full min-h-[460px] rounded-2xl border border-border bg-card p-4 text-sm text-rose-300">{error}</section>;
  }

  if (!data) {
    return <section className="h-full min-h-[460px] rounded-2xl border border-border bg-card p-4 text-sm text-zinc-400">SMTP sağlığı yükleniyor...</section>;
  }

  return <SmtpHealthSummary smtpTotals={data.smtpTotals} smtpStates={data.smtpStates} />;
}
