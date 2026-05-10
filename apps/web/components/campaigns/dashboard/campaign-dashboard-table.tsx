"use client";

import Link from "next/link";
import { Loader2, Megaphone } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { CampaignRow } from "./campaign-dashboard-types";
import { fmtDate, fmtInt, shortCampaignRef } from "./campaign-dashboard-utils";
import { CampaignRowActionsMenu } from "./campaign-row-actions-menu";
import { CampaignStatusBadge } from "./campaign-status-badge";
import { campaignTheme } from "./campaign-theme";

function progressBarWidth(progress: number): number {
  const raw = Math.max(0, Math.min(100, progress));
  if (raw <= 0) return 0;
  return Math.max(raw, 3);
}

export function CampaignDashboardTable({
  loading,
  listError,
  items,
  total,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pendingAction,
  onRowClick,
  onView,
  onReport,
  onAction
}: {
  loading: boolean;
  listError: string | null;
  items: CampaignRow[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  pendingAction: string | null;
  onRowClick: (id: string) => void;
  onView: (id: string) => void;
  onReport: (id: string) => void;
  onAction: (id: string, action: "start" | "pause" | "resume" | "cancel" | "delete", row: CampaignRow) => void;
}) {
  if (loading) {
    return (
      <section
        className={`flex min-h-[240px] items-center justify-center rounded-2xl border ${campaignTheme.border} bg-[#10141F]/80`}
      >
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
          Kampanya verileri yükleniyor…
        </p>
      </section>
    );
  }

  if (!loading && listError && items.length === 0) {
    return (
      <section className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-6 shadow-[0_0_24px_-10px_rgba(251,113,133,0.35)]">
        <p className="text-sm font-semibold text-rose-100">Liste yüklenemedi</p>
        <p className="mt-1 text-xs text-rose-200/85">{listError}</p>
      </section>
    );
  }

  if (!loading && items.length === 0 && !listError) {
    return (
      <section className={`rounded-2xl border ${campaignTheme.border} bg-[#121722]/90 p-8`}>
        <EmptyState
          icon="megaphone"
          title="Kampanya bulunamadı"
          description="Filtreleri sıfırlayıp tekrar deneyin veya yeni kampanya başlatın."
        />
        <div className="mt-6 flex justify-center">
          <Link
            href="/send"
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/35 transition ${campaignTheme.primaryGradient} ${campaignTheme.primaryGradientHover}`}
          >
            Yeni kampanya
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`overflow-hidden rounded-2xl border ${campaignTheme.border} bg-gradient-to-b from-[#121722] to-[#0e131c] shadow-xl shadow-black/40`}
    >
      {listError ? (
        <div
          className={`border-b ${campaignTheme.border} bg-amber-500/10 px-4 py-3 text-xs text-amber-100/95 ring-1 ring-amber-400/20 sm:px-5`}
        >
          Liste yenilenemedi: {listError}. Önceki veriler gösteriliyor.
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[14%]" />
            <col className="w-[18%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead>
            <tr className={`border-b ${campaignTheme.border} text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500`}>
              <th className="px-4 py-4 pl-5">Kampanya</th>
              <th className="px-4 py-4">Şablon</th>
              <th className="px-4 py-4">Liste/Segment</th>
              <th className="px-4 py-4">Durum</th>
              <th className="px-4 py-4">Sayılar</th>
              <th className="px-4 py-4">İlerleme</th>
              <th className="px-4 py-4">Son aktivite</th>
              <th className="px-4 py-4 pr-5 text-right">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.id)}
                className={`cursor-pointer border-b border-[#1a2233] transition hover:bg-indigo-500/[0.06] hover:shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]`}
              >
                <td className="px-4 py-4 pl-5 align-top">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-500/20 text-indigo-200 shadow-[0_0_14px_-4px_rgba(99,102,241,0.45)]">
                      <Megaphone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white">{row.name}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">ID: {shortCampaignRef(row.createdAt, row.id)}</p>
                    </div>
                  </div>
                </td>
                <td className="truncate px-4 py-4 align-top text-zinc-300" title={row.template?.title ?? undefined}>
                  {row.template?.title ?? "—"}
                </td>
                <td
                  className="truncate px-4 py-4 align-top text-zinc-300"
                  title={row.list?.name ?? row.segment?.name ?? undefined}
                >
                  {row.list?.name ?? row.segment?.name ?? "—"}
                </td>
                <td className="px-4 py-4 align-top">
                  <CampaignStatusBadge status={row.status} />
                </td>
                <td className="px-4 py-4 align-top font-mono text-[11px] leading-relaxed text-zinc-400">
                  <div>T: {fmtInt(row.targetedCount)}</div>
                  <div>G: {fmtInt(row.sentCount)}</div>
                  <div>S: {fmtInt(row.skippedCount)}</div>
                  <div>
                    F: {fmtInt(row.failedCount)} · K: {fmtInt(row.queuedCount)}
                  </div>
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="w-full max-w-[9rem]">
                    <div className="h-2 overflow-hidden rounded-full bg-[#1e2535] ring-1 ring-white/[0.06]">
                      <div
                        className="h-full min-h-[6px] rounded-full bg-gradient-to-r from-[#6366f1] via-[#7c3aed] to-[#8b5cf6] shadow-[0_0_10px_rgba(99,102,241,0.55)]"
                        style={{ width: `${progressBarWidth(row.progress)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs font-semibold tabular-nums text-zinc-200">{row.progress}%</p>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-4 align-top text-xs text-zinc-400">{fmtDate(row.lastActivity)}</td>
                <td className="px-4 py-4 pr-5 align-top text-right">
                  <CampaignRowActionsMenu
                    row={row}
                    pendingAction={pendingAction}
                    onView={() => onView(row.id)}
                    onReport={() => onReport(row.id)}
                    onAction={(a) => onAction(row.id, a, row)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer
        className={`flex flex-col gap-3 border-t ${campaignTheme.border} px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5`}
      >
        <p className="text-xs text-zinc-500">
          <span className="font-semibold text-zinc-200">{fmtInt(total)}</span> kampanya · Sayfa{" "}
          <span className="tabular-nums text-zinc-200">{page}</span> / {totalPages}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={`${pageSize}`}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className={`rounded-lg border ${campaignTheme.border} bg-[#0a0e16] px-2 py-1.5 text-xs font-medium text-zinc-200`}
          >
            <option value="25">25 / sayfa</option>
            <option value="50">50 / sayfa</option>
            <option value="100">100 / sayfa</option>
          </select>
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className={`rounded-lg border ${campaignTheme.border} bg-[#10141F] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/30 disabled:opacity-40`}
          >
            Önceki
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className={`rounded-lg border ${campaignTheme.border} bg-[#10141F] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/30 disabled:opacity-40`}
          >
            Sonraki
          </button>
        </div>
      </footer>
    </section>
  );
}
