"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

type FlowPayload = {
  ok: boolean;
  metrics: {
    currentRps: number;
    sentLastMinute: number;
    failedLastMinute: number;
    queuePending: number;
    queueProcessing: number;
    activeCampaigns: number;
  };
  smtpActivity: Array<{
    smtpId: string;
    fromEmail: string;
    status: string;
    sentToday: number;
    failedToday: number;
    currentRps: number;
    lastUsedAt: string | null;
  }>;
  recentEvents: Array<{
    time: string;
    campaignName: string;
    smtpFromEmail: string;
    recipientEmail: string;
    status: "success" | "failed";
    error: string | null;
  }>;
};

type Props = {
  compact?: boolean;
};

export function LiveSmtpFlowCard({ compact = false }: Props) {
  const [data, setData] = useState<FlowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<"all" | "success" | "failed">("all");

  const refresh = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/smtp/live-flow", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as FlowPayload & {
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Canli SMTP akisi kullanilamiyor");
      }
      setData(payload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Canli SMTP akisi kullanilamiyor");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const events = useMemo(() => {
    const base = data?.recentEvents ?? [];
    if (filter === "all") return base;
    return base.filter((item) => item.status === filter);
  }, [data?.recentEvents, filter]);

  const rotationMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const event of data?.recentEvents ?? []) {
      const set = map.get(event.campaignName) ?? new Set<string>();
      set.add(event.smtpFromEmail);
      map.set(event.campaignName, set);
    }
    return Array.from(map.entries())
      .map(([campaignName, smtpSet]) => ({ campaignName, smtpCount: smtpSet.size }))
      .sort((a, b) => b.smtpCount - a.smtpCount)
      .slice(0, 5);
  }, [data?.recentEvents]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-200">Canli SMTP Akisi</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-zinc-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Yenile
          </button>
          <label className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Otomatik
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "success" | "failed")}
            className="rounded border border-border bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="all">tum</option>
            <option value="success">basarili</option>
            <option value="failed">basarisiz</option>
          </select>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Canli akis yukleniyor...
        </div>
      ) : null}
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}

      <div className={`grid gap-2 ${compact ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-6"}`}>
        <FlowStat label="RPS" value={data?.metrics.currentRps ?? 0} />
        <FlowStat label="Gonderilen/dk" value={data?.metrics.sentLastMinute ?? 0} />
        <FlowStat label="Basarisiz/dk" value={data?.metrics.failedLastMinute ?? 0} />
        <FlowStat label="Kuyruk bekleyen" value={data?.metrics.queuePending ?? 0} />
        <FlowStat label="Kuyruk islenen" value={data?.metrics.queueProcessing ?? 0} />
        <FlowStat label="Aktif kampanya" value={data?.metrics.activeCampaigns ?? 0} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-zinc-900/40 p-2">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Son olaylar (son 20)</p>
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-zinc-300">
              <thead className="sticky top-0 bg-zinc-900/90 text-zinc-500">
                <tr>
                  <th className="border-b border-border px-2 py-1">Saat</th>
                  <th className="border-b border-border px-2 py-1">Kampanya</th>
                  <th className="border-b border-border px-2 py-1">SMTP</th>
                  <th className="border-b border-border px-2 py-1">Alici</th>
                  <th className="border-b border-border px-2 py-1">Durum</th>
                  <th className="border-b border-border px-2 py-1">Hata</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={`${event.time}-${event.campaignName}-${event.recipientEmail}`}
                    className={event.status === "failed" ? "bg-rose-500/10" : ""}
                  >
                    <td className="border-b border-border/50 px-2 py-1">{new Date(event.time).toLocaleTimeString()}</td>
                    <td className="border-b border-border/50 px-2 py-1">{event.campaignName}</td>
                    <td className="border-b border-border/50 px-2 py-1">{event.smtpFromEmail}</td>
                    <td className="border-b border-border/50 px-2 py-1">{event.recipientEmail}</td>
                    <td className="border-b border-border/50 px-2 py-1">
                      <StatusBadge label={event.status} tone={event.status === "failed" ? "danger" : "success"} />
                    </td>
                    <td className="border-b border-border/50 px-2 py-1 text-rose-300">
                      {event.status === "failed" ? event.error ?? "-" : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-zinc-900/40 p-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">SMTP aktivitesi</p>
          <div className="max-h-36 space-y-1 overflow-auto">
            {(data?.smtpActivity ?? []).map((item) => (
              <div key={item.smtpId} className="rounded border border-border px-2 py-1 text-xs text-zinc-300">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate">{item.fromEmail}</p>
                  <StatusBadge
                    label={item.status}
                    tone={item.status === "active" ? "success" : item.status === "throttled" ? "warning" : "danger"}
                  />
                </div>
                <p className="text-[11px] text-zinc-500">
                  gonderilen:{item.sentToday} basarisiz:{item.failedToday} rps:{item.currentRps}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded border border-border px-2 py-2">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">SMTP donusum aktivitesi</p>
            {rotationMap.length === 0 ? (
              <p className="text-xs text-zinc-500">Son donusum verisi yok.</p>
            ) : (
              rotationMap.map((item) => (
                <p key={item.campaignName} className="text-xs text-zinc-300">
                  {item.campaignName}: {item.smtpCount} SMTP kullanildi
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-zinc-900/50 px-2 py-1.5">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{Number.isFinite(value) ? value.toLocaleString() : "-"}</p>
    </div>
  );
}
