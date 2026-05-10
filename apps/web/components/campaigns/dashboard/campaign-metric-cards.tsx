"use client";

import { useState } from "react";
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eye,
  Layers,
  Mail,
  MousePointerClick,
  Pause,
  ShieldAlert,
  SkipForward,
  TrendingUp,
  XCircle
} from "lucide-react";
import type { ListStats } from "./campaign-dashboard-types";
import { fmtInt } from "./campaign-dashboard-utils";
import { campaignTheme } from "./campaign-theme";

type MetricDef = {
  key: string;
  title: string;
  value: string;
  hint: string;
  icon: typeof BarChart3;
  accent?: "default" | "success" | "warning" | "danger" | "info";
};

const cardBase = `group relative flex h-full flex-col overflow-hidden rounded-2xl border ${campaignTheme.border} bg-gradient-to-b ${campaignTheme.cardBgGradient} p-5 shadow-md shadow-black/20 transition ${campaignTheme.borderHoverGlow}`;

const iconWrap: Record<NonNullable<MetricDef["accent"]>, string> = {
  default: "border-[#3d4a63] bg-[#1c2436] text-indigo-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
  success:
    "border-emerald-400/45 bg-emerald-500/20 text-emerald-200 shadow-[0_0_16px_-6px_rgba(52,211,153,0.45)]",
  warning:
    "border-amber-400/50 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_-6px_rgba(251,191,36,0.35)]",
  danger: "border-rose-400/45 bg-rose-500/20 text-rose-100 shadow-[0_0_14px_-6px_rgba(251,113,133,0.35)]",
  info: "border-sky-400/45 bg-sky-500/20 text-sky-100 shadow-[0_0_14px_-6px_rgba(56,189,248,0.35)]"
};

function MetricCard({ item }: { item: MetricDef }) {
  const accent = item.accent ?? "default";
  const Icon = item.icon;
  return (
    <div className={cardBase}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">{item.title}</p>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${iconWrap[accent]}`}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{item.value}</p>
      <p className="mt-2 text-xs leading-snug text-zinc-400">{item.hint}</p>
    </div>
  );
}

export function CampaignMetricCards({
  stats,
  statsWarning
}: {
  stats: ListStats | undefined;
  statsWarning?: string | null;
}) {
  const [open, setOpen] = useState(false);

  const pendingQueue = (stats?.queue.waiting ?? 0) + (stats?.queue.delayed ?? 0);

  const primary: MetricDef[] = [
    {
      key: "total",
      title: "Toplam Kampanya",
      value: fmtInt(stats?.totalCampaigns ?? 0),
      hint: "Tüm zamanlar",
      icon: BarChart3
    },
    {
      key: "running",
      title: "Çalışıyor",
      value: fmtInt(stats?.runningCampaigns ?? 0),
      hint: "Şu anda aktif",
      icon: Activity,
      accent: "success"
    },
    {
      key: "sent",
      title: "Gönderildi",
      value: fmtInt(stats?.totalSent ?? 0),
      hint: "Başarılı gönderimler",
      icon: Mail,
      accent: "success"
    },
    {
      key: "pending",
      title: "Bekleyen",
      value: fmtInt(pendingQueue),
      hint: "Kuyrukta bekleyen işler",
      icon: Layers,
      accent: "warning"
    },
    {
      key: "rate",
      title: "Teslimat Oranı",
      value: `${(stats?.averageDeliveryRate ?? 0).toFixed(2)}%`,
      hint: "Ortalama teslimat",
      icon: TrendingUp,
      accent: "info"
    },
    {
      key: "skipped",
      title: "Atlandı",
      value: fmtInt(stats?.totalSkipped ?? 0),
      hint: "Atlanan iletiler",
      icon: SkipForward,
      accent: "warning"
    }
  ];

  return (
    <section className="space-y-3">
      {statsWarning ? (
        <p
          className={`rounded-xl border ${campaignTheme.border} bg-amber-500/10 px-4 py-2 text-xs text-amber-100/95 ring-1 ring-amber-400/20`}
        >
          {statsWarning}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {primary.map((m) => (
          <MetricCard key={m.key} item={m} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border ${campaignTheme.border} bg-[#10141F] py-2.5 text-xs font-semibold text-zinc-300 shadow-sm transition hover:border-indigo-500/50 hover:text-white hover:shadow-[0_0_22px_-8px_rgba(99,102,241,0.4)]`}
      >
        {open ? <ChevronUp className="h-4 w-4 text-indigo-300" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
        Detaylı metrikler
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid grid-cols-1 gap-3 pb-1 pt-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              item={{
                key: "failed",
                title: "Başarısız",
                value: fmtInt(stats?.totalFailed ?? 0),
                hint: "Gönderim hatası",
                icon: ShieldAlert,
                accent: "danger"
              }}
            />
            <MetricCard
              item={{
                key: "opened",
                title: "Açılma",
                value: fmtInt(stats?.totalOpened ?? 0),
                hint: "Toplam açılma",
                icon: Eye,
                accent: "info"
              }}
            />
            <MetricCard
              item={{
                key: "clicked",
                title: "Tıklama",
                value: fmtInt(stats?.totalClicked ?? 0),
                hint: "Toplam tıklama",
                icon: MousePointerClick,
                accent: "info"
              }}
            />
            <MetricCard
              item={{
                key: "canceled",
                title: "İptal Edildi",
                value: fmtInt(stats?.canceledCampaigns ?? 0),
                hint: "Kampanya sayısı",
                icon: XCircle,
                accent: "danger"
              }}
            />
            <MetricCard
              item={{
                key: "paused",
                title: "Duraklatıldı",
                value: fmtInt(stats?.pausedCampaigns ?? 0),
                hint: "Kampanya sayısı",
                icon: Pause,
                accent: "warning"
              }}
            />
            <MetricCard
              item={{
                key: "completed",
                title: "Tamamlandı",
                value: fmtInt(stats?.completedCampaigns ?? 0),
                hint: "Kampanya sayısı",
                icon: Activity,
                accent: "success"
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
