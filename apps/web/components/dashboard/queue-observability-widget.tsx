"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

type QueuePayload = {
  deliveryCounts: Record<string, number>;
  retryCounts: Record<string, number>;
  deadCounts: Record<string, number>;
  latencyMs: number;
  workerConcurrency: number;
  throughputBySmtp: Array<{ smtpAccountId: string; sentLastMinute: number }>;
  throttledStates: Array<{ id: string; name: string; throttleReason: string | null }>;
  sharedSafety: Array<{
    smtpAccountId: string;
    total: number;
    failures: number;
    throttleLevel: number;
    throttledUntil: number;
  }>;
};

export function QueueObservabilityWidget() {
  const [data, setData] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const pull = async () => {
      try {
        const response = await fetch("/api/observability/queues");
        if (!response.ok) {
          throw new Error("Kuyruk metrikleri kullanilamiyor");
        }
        const payload = (await response.json()) as QueuePayload;
        if (mounted) {
          setData(payload);
          setError(null);
        }
      } catch (pullError) {
        if (mounted) {
          setError(pullError instanceof Error ? pullError.message : "Metrik istegi basarisiz oldu");
        }
      }
    };
    void pull();
    const interval = setInterval(() => void pull(), 4000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm text-zinc-300">Kuyruk Gozlemlenebilirligi</h3>
      {!data && !error ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Kuyruk metrikleri yukleniyor...
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <EmptyState icon="loader" title="Queue verisi alinamadi" description={error} />
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <Stat label="Aktif Isler" value={data?.deliveryCounts.active ?? 0} />
        <Stat label="Bekleyen Isler" value={data?.deliveryCounts.waiting ?? 0} />
        <Stat label="Kuyruk Gecikmesi" value={`${Math.round((data?.latencyMs ?? 0) / 1000)}sn`} />
        <Stat label="Worker Eszamanlilik" value={data?.workerConcurrency ?? 0} />
      </div>
      <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        {(data?.throughputBySmtp ?? []).slice(0, 4).map((item) => (
          <p key={item.smtpAccountId}>
            SMTP {item.smtpAccountId.slice(0, 8)}... : {item.sentLastMinute}/dk
          </p>
        ))}
      </div>
      <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        <p className="mb-1 uppercase tracking-wider text-zinc-400">Sinirlama Durumu</p>
        {(data?.throttledStates ?? []).length === 0 ? <p>Sinirlanan SMTP yok.</p> : null}
        {(data?.throttledStates ?? []).map((item) => (
          <div key={item.id} className="mb-1 flex items-center justify-between gap-2">
            <p>{item.name}</p>
            <StatusBadge label={item.throttleReason ?? "sinirlandi"} tone="warning" />
          </div>
        ))}
      </div>
      <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        <p className="mb-1 uppercase tracking-wider text-zinc-400">Paylasilan Guvenlik</p>
        {(data?.sharedSafety ?? []).slice(0, 4).map((item) => (
          <p key={item.smtpAccountId}>
            {item.smtpAccountId?.slice(0, 8)}... lvl={item.throttleLevel} fail={item.failures}/{item.total}
          </p>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-zinc-900/40 p-2">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}
