"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    let mounted = true;
    const pull = async () => {
      const response = await fetch("/api/observability/queues");
      if (!response.ok) return;
      const payload = (await response.json()) as QueuePayload;
      if (mounted) setData(payload);
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
      <h3 className="text-sm text-zinc-300">Queue Observability</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <Stat label="Active Jobs" value={data?.deliveryCounts.active ?? 0} />
        <Stat label="Waiting Jobs" value={data?.deliveryCounts.waiting ?? 0} />
        <Stat label="Queue Latency" value={`${Math.round((data?.latencyMs ?? 0) / 1000)}s`} />
        <Stat label="Worker Concurrency" value={data?.workerConcurrency ?? 0} />
      </div>
      <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        {(data?.throughputBySmtp ?? []).slice(0, 4).map((item) => (
          <p key={item.smtpAccountId}>
            SMTP {item.smtpAccountId.slice(0, 8)}... : {item.sentLastMinute}/min
          </p>
        ))}
      </div>
      <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        <p className="mb-1 uppercase tracking-wider text-zinc-400">Throttle State</p>
        {(data?.throttledStates ?? []).length === 0 ? <p>No throttled SMTP.</p> : null}
        {(data?.throttledStates ?? []).map((item) => (
          <p key={item.id}>
            {item.name}: {item.throttleReason ?? "throttled"}
          </p>
        ))}
      </div>
      <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        <p className="mb-1 uppercase tracking-wider text-zinc-400">Shared Safety</p>
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
