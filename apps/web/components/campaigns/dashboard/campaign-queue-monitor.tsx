"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import type { ListStats, QueueAdminAction, QueueAdminResponse } from "./campaign-dashboard-types";
import { fmtInt } from "./campaign-dashboard-utils";
import { campaignTheme } from "./campaign-theme";

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

  const outlineBtn = `rounded-xl border ${campaignTheme.border} bg-[#10141F] px-4 py-2 text-xs font-semibold text-zinc-200 shadow-sm transition hover:border-[#3d4a63] hover:bg-[#151b28] hover:shadow-[0_0_18px_-8px_rgba(99,102,241,0.25)] disabled:opacity-50`;

  return (
    <section
      className={`rounded-2xl border ${campaignTheme.border} bg-gradient-to-br from-[#10141F] to-[#0c1018] p-6 shadow-lg shadow-black/30`}
    >
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Canlı Kuyruk İzleme</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 shadow-[0_0_14px_-4px_rgba(52,211,153,0.4)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
            </span>
            Gerçek zamanlı
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={`${autoRefresh}`}
            onChange={(e) => onAutoRefreshChange(Number(e.target.value) as 0 | 5 | 10)}
            className={`rounded-xl border ${campaignTheme.border} bg-[#0a0e16] px-3 py-2 text-xs font-medium text-zinc-200 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30`}
          >
            <option value="0">Yenileme: kapalı</option>
            <option value="5">Yenileme: 5 sn</option>
            <option value="10">Yenileme: 10 sn</option>
          </select>
          <button type="button" onClick={() => onRefresh()} className={`inline-flex items-center gap-2 ${outlineBtn}`}>
            <RefreshCw className="h-3.5 w-3.5 text-indigo-300" />
            Yenile
          </button>
          <button
            type="button"
            disabled={queueActionLoading !== null}
            onClick={() => onQueueAction("pause")}
            className={outlineBtn}
          >
            Kuyruğu Duraklat
          </button>
          <button
            type="button"
            disabled={queueActionLoading !== null}
            onClick={() => onQueueAction("resume")}
            className={`rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/30 transition disabled:opacity-50 ${campaignTheme.primaryGradient} ${campaignTheme.primaryGradientHover}`}
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
              className={`inline-flex items-center gap-2 rounded-xl border ${campaignTheme.border} bg-transparent px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-[#3d4a63] hover:text-zinc-200`}
            >
              <MoreHorizontal className="h-4 w-4" />
              Gelişmiş
            </button>
            {advancedOpen ? (
              <div
                className={`absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border ${campaignTheme.border} bg-[#121722] py-1 shadow-2xl shadow-black/50 ring-1 ring-indigo-500/10`}
              >
                <button
                  type="button"
                  disabled={queueActionLoading !== null}
                  className="block w-full px-4 py-2.5 text-left text-xs font-medium text-amber-100/95 hover:bg-amber-500/10 disabled:opacity-50"
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
                  className="block w-full px-4 py-2.5 text-left text-xs text-zinc-200 hover:bg-[#1a2233] disabled:opacity-50"
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
                  className="block w-full px-4 py-2.5 text-left text-xs text-zinc-200 hover:bg-[#1a2233] disabled:opacity-50"
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
        <p
          className={`mb-4 rounded-lg border ${campaignTheme.border} bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90 ring-1 ring-amber-400/25`}
        >
          {queueWarning}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QueueMetric label="Bekleyen" value={q?.waiting ?? 0} variant="amber" />
        <QueueMetric label="Aktif" value={q?.active ?? 0} variant="emerald" />
        <QueueMetric label="Başarısız" value={q?.failed ?? 0} variant="rose" />
        <QueueMetric label="Gecikmeli" value={q?.delayed ?? 0} variant="sky" />
      </div>

      {queueSummary ? (
        <div className={`mt-4 rounded-xl border ${campaignTheme.border} bg-[#0a0e16]/90 p-4 text-xs text-zinc-400`}>
          <p className="font-semibold text-zinc-200">Son kuyruk işlemi</p>
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
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
          Kuyruk işlemi çalışıyor…
        </div>
      ) : null}
    </section>
  );
}

function QueueMetric({
  label,
  value,
  variant
}: {
  label: string;
  value: number;
  variant: "amber" | "emerald" | "rose" | "sky";
}) {
  const styles = {
    amber: {
      wrap: "border-amber-400/35 bg-gradient-to-br from-amber-500/25 via-amber-600/10 to-transparent shadow-[0_0_20px_-8px_rgba(251,191,36,0.35)]",
      label: "text-amber-100/80",
      num: "text-amber-50"
    },
    emerald: {
      wrap: "border-emerald-400/35 bg-gradient-to-br from-emerald-500/25 via-emerald-600/10 to-transparent shadow-[0_0_20px_-8px_rgba(52,211,153,0.35)]",
      label: "text-emerald-100/85",
      num: "text-emerald-50"
    },
    rose: {
      wrap: "border-rose-400/35 bg-gradient-to-br from-rose-500/25 via-rose-600/10 to-transparent shadow-[0_0_20px_-8px_rgba(251,113,133,0.35)]",
      label: "text-rose-100/85",
      num: "text-rose-50"
    },
    sky: {
      wrap: "border-sky-400/35 bg-gradient-to-br from-sky-500/25 via-indigo-600/10 to-transparent shadow-[0_0_20px_-8px_rgba(56,189,248,0.35)]",
      label: "text-sky-100/85",
      num: "text-sky-50"
    }
  }[variant];

  return (
    <div className={`rounded-2xl border-2 p-4 ${styles.wrap}`}>
      <p className={`text-[11px] font-bold uppercase tracking-wide ${styles.label}`}>{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums drop-shadow-sm ${styles.num}`}>{fmtInt(value)}</p>
    </div>
  );
}
