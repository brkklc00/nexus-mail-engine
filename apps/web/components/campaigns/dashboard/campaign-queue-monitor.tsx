"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import type { ListStats, QueueAdminAction, QueueAdminResponse } from "./campaign-dashboard-types";
import { fmtInt } from "./campaign-dashboard-utils";

export function CampaignQueueMonitor({
  stats,
  queueSummary,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onQueueAction,
  queueActionLoading,
  queueWarning
}: {
  stats: ListStats | undefined;
  queueSummary: QueueAdminResponse | null;
  autoRefresh: 0 | 5 | 10;
  onAutoRefreshChange: (v: 0 | 5 | 10) => void;
  onRefresh: () => void;
  onQueueAction: (action: QueueAdminAction) => void;
  queueActionLoading: QueueAdminAction | null;
  queueWarning?: string | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!advancedOpen) return;
      if (advRef.current && !advRef.current.contains(e.target as Node)) setAdvancedOpen(false);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [advancedOpen]);

  const q = stats?.queue;

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-zinc-900/60 to-zinc-950 p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Canlı Kuyruk İzleme</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Gerçek zamanlı
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={`${autoRefresh}`}
            onChange={(e) => onAutoRefreshChange(Number(e.target.value) as 0 | 5 | 10)}
            className="rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500/50"
          >
            <option value="0">Yenileme: kapalı</option>
            <option value="5">Yenileme: 5 sn</option>
            <option value="10">Yenileme: 10 sn</option>
          </select>
          <button
            type="button"
            onClick={() => onRefresh()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/80 px-4 py-2 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/30 hover:bg-zinc-900"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Yenile
          </button>
          <button
            type="button"
            disabled={queueActionLoading !== null}
            onClick={() => onQueueAction("pause")}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-900 disabled:opacity-50"
          >
            Kuyruğu Duraklat
          </button>
          <button
            type="button"
            disabled={queueActionLoading !== null}
            onClick={() => onQueueAction("resume")}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-900 disabled:opacity-50"
          >
            Kuyruğu Devam Ettir
          </button>
          <div className="relative" ref={advRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAdvancedOpen((o) => !o);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
            >
              <MoreHorizontal className="h-4 w-4" />
              Gelişmiş
            </button>
            {advancedOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 py-1 shadow-xl">
                <button
                  type="button"
                  disabled={queueActionLoading !== null}
                  className="block w-full px-4 py-2.5 text-left text-xs text-amber-200/90 hover:bg-zinc-900 disabled:opacity-50"
                  onClick={() => {
                    setAdvancedOpen(false);
                    onQueueAction("clean_stale_campaign_jobs");
                  }}
                >
                  Eski / iptal edilmiş işleri temizle
                </button>
                <button
                  type="button"
                  disabled={queueActionLoading !== null}
                  className="block w-full px-4 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                  onClick={() => {
                    setAdvancedOpen(false);
                    onQueueAction("clean_failed");
                  }}
                >
                  Başarısız işleri temizle
                </button>
                <button
                  type="button"
                  disabled={queueActionLoading !== null}
                  className="block w-full px-4 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                  onClick={() => {
                    setAdvancedOpen(false);
                    onQueueAction("clean_completed");
                  }}
                >
                  Tamamlanan işleri temizle
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {queueWarning ? (
        <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">{queueWarning}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QueueMetric label="Bekleyen" value={q?.waiting ?? 0} tone="amber" />
        <QueueMetric label="Aktif" value={q?.active ?? 0} tone="emerald" />
        <QueueMetric label="Başarısız" value={q?.failed ?? 0} tone="rose" />
        <QueueMetric label="Gecikmeli" value={q?.delayed ?? 0} tone="sky" />
      </div>

      {queueSummary ? (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-4 text-xs text-zinc-400">
          <p className="font-medium text-zinc-300">Son kuyruk işlemi</p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <p>Taranan: {queueSummary.scanned ?? queueSummary.progress?.scanned ?? 0}</p>
            <p>Temizlenen: {queueSummary.cleaned ?? 0}</p>
            <p>Korunan aktif: {queueSummary.skippedActive ?? 0}</p>
            <p>Kalan: {queueSummary.remaining ?? queueSummary.progress?.remaining ?? 0}</p>
          </div>
        </div>
      ) : null}

      {queueActionLoading && queueActionLoading !== "pause" && queueActionLoading !== "resume" ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Kuyruk işlemi çalışıyor…
        </div>
      ) : null}
    </section>
  );
}

function QueueMetric({ label, value, tone }: { label: string; value: number; tone: "amber" | "emerald" | "rose" | "sky" }) {
  const ring =
    tone === "emerald"
      ? "from-emerald-500/15 to-transparent border-emerald-500/20"
      : tone === "amber"
        ? "from-amber-500/15 to-transparent border-amber-500/20"
        : tone === "rose"
          ? "from-rose-500/15 to-transparent border-rose-500/20"
          : "from-sky-500/15 to-transparent border-sky-500/20";
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${ring}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{fmtInt(value)}</p>
    </div>
  );
}
