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

type MetricDef = {
  key: string;
  title: string;
  value: string;
  hint: string;
  icon: typeof BarChart3;
  accent?: "default" | "success" | "warning" | "danger" | "info";
};

const cardBase =
  "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 p-5 shadow-sm transition hover:border-indigo-500/25 hover:shadow-md hover:shadow-indigo-500/5";

const iconWrap: Record<NonNullable<MetricDef["accent"]>, string> = {
  default: "border-white/10 bg-white/5 text-zinc-300",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-200",
  danger: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  info: "border-sky-500/20 bg-sky-500/10 text-sky-200"
};

function MetricCard({ item }: { item: MetricDef }) {
  const accent = item.accent ?? "default";
  const Icon = item.icon;
  return (
    <div className={cardBase}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{item.title}</p>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${iconWrap[accent]}`}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{item.value}</p>
      <p className="mt-2 text-xs leading-snug text-zinc-500">{item.hint}</p>
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
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs text-amber-200/90">{statsWarning}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {primary.map((m) => (
          <MetricCard key={m.key} item={m} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/40 py-2.5 text-xs font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Detaylı metrikler
      </button>

      {open ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
      ) : null}
    </section>
  );
}
