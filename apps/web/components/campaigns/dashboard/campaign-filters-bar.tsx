"use client";

import { Filter, RotateCcw, Search } from "lucide-react";
import type { FilterOptions } from "./campaign-dashboard-types";

const statusOptions = [
  "all",
  "pending",
  "queued",
  "running",
  "paused",
  "completed",
  "partially_completed",
  "failed",
  "canceled"
] as const;

const rangeOptions = [
  { id: "all", label: "Tümü" },
  { id: "24h", label: "Son 24 saat" },
  { id: "7d", label: "Son 7 gün" },
  { id: "30d", label: "Son 30 gün" },
  { id: "custom", label: "Özel aralık" }
];

type Props = {
  search: string;
  onSearchChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  templateId: string;
  onTemplateIdChange: (v: string) => void;
  listSegmentId: string;
  onListSegmentIdChange: (v: string) => void;
  smtpAccountId: string;
  onSmtpAccountIdChange: (v: string) => void;
  listsAndSegments: Array<{ id: string; label: string }>;
  filters: FilterOptions | undefined;
  range: string;
  onRangeChange: (v: string) => void;
  from: string;
  onFromChange: (v: string) => void;
  to: string;
  onToChange: (v: string) => void;
  advancedFiltersOpen: boolean;
  onToggleAdvanced: () => void;
  onApply: () => void;
  onReset: () => void;
  getStatusLabel: (s: string) => string;
};

export function CampaignFiltersBar(props: Props) {
  const {
    search,
    onSearchChange,
    status,
    onStatusChange,
    templateId,
    onTemplateIdChange,
    listSegmentId,
    onListSegmentIdChange,
    smtpAccountId,
    onSmtpAccountIdChange,
    listsAndSegments,
    filters,
    range,
    onRangeChange,
    from,
    onFromChange,
    to,
    onToChange,
    advancedFiltersOpen,
    onToggleAdvanced,
    onApply,
    onReset,
    getStatusLabel
  } = props;

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <label className="relative min-w-[200px] flex-1 lg:min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Kampanya ara..."
            className="w-full rounded-xl border border-white/10 bg-zinc-950/80 py-2.5 pl-10 pr-3 text-sm text-zinc-100 outline-none transition focus:border-indigo-500/40"
          />
        </label>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="min-w-[140px] rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
          aria-label="Durum"
        >
          {statusOptions.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "Durum: Tümü" : `Durum: ${getStatusLabel(item)}`}
            </option>
          ))}
        </select>
        <select
          value={templateId}
          onChange={(e) => onTemplateIdChange(e.target.value)}
          className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
          aria-label="Şablon"
        >
          <option value="all">Şablon: Tümü</option>
          {filters?.templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <select
          value={listSegmentId}
          onChange={(e) => onListSegmentIdChange(e.target.value)}
          className="min-w-[180px] flex-1 rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
          aria-label="Liste veya segment"
        >
          <option value="all">Liste/Segment: Tümü</option>
          {listsAndSegments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={smtpAccountId}
          onChange={(e) => onSmtpAccountIdChange(e.target.value)}
          className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500/40"
          aria-label="SMTP"
        >
          <option value="all">SMTP: Tümü</option>
          {filters?.smtpAccounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <button
            type="button"
            onClick={onToggleAdvanced}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition ${
              advancedFiltersOpen
                ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
                : "border-white/10 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Gelişmiş filtreler
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:shadow-lg hover:shadow-indigo-500/30"
          >
            Filtreleri Uygula
          </button>
          <button
            type="button"
            onClick={onReset}
            title="Sıfırla"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {advancedFiltersOpen ? (
        <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <select
            value={range}
            onChange={(e) => onRangeChange(e.target.value)}
            className="rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100"
          >
            {rangeOptions.map((item) => (
              <option key={item.id} value={item.id}>
                Tarih: {item.label}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            disabled={range !== "custom"}
            className="rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          />
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            disabled={range !== "custom"}
            className="rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      ) : null}
    </section>
  );
}
