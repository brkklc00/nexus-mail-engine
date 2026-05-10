"use client";

import Link from "next/link";
import { Loader2, Megaphone } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { CampaignRow } from "./campaign-dashboard-types";
import { fmtDate, fmtInt, getCampaignStatusLabel, shortCampaignRef, toneForCampaignStatus } from "./campaign-dashboard-utils";
import { CampaignRowActionsMenu } from "./campaign-row-actions-menu";

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
      <section className="flex min-h-[240px] items-center justify-center rounded-2xl border border-white/[0.08] bg-zinc-900/30">
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
          Kampanya verileri yükleniyor…
        </p>
      </section>
    );
  }

  if (!loading && listError && items.length === 0) {
    return (
      <section className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-6">
        <p className="text-sm font-medium text-rose-200">Liste yüklenemedi</p>
        <p className="mt-1 text-xs text-rose-200/80">{listError}</p>
      </section>
    );
  }

  if (!loading && items.length === 0 && !listError) {
    return (
      <section className="rounded-2xl border border-white/[0.08] bg-zinc-900/30 p-8">
        <EmptyState
          icon="megaphone"
          title="Kampanya bulunamadı"
          description="Filtreleri sıfırlayıp tekrar deneyin veya yeni kampanya başlatın."
        />
        <div className="mt-6 flex justify-center">
          <Link
            href="/send"
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20"
          >
            Yeni kampanya
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-zinc-900/50 to-zinc-950/80 shadow-sm">
      {listError ? (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100/90 sm:px-5">
          Liste yenilenemedi: {listError}. Önceki veriler gösteriliyor.
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-4 pl-5">Kampanya</th>
              <th className="px-4 py-4">Şablon</th>
              <th className="px-4 py-4">Liste/Segment</th>
              <th className="px-4 py-4">SMTP</th>
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
                className="cursor-pointer border-b border-white/[0.04] transition hover:bg-white/[0.03]"
              >
                <td className="px-4 py-4 pl-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-300">
                      <Megaphone className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        ID: {shortCampaignRef(row.createdAt, row.id)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="max-w-[140px] truncate px-4 py-4 text-zinc-300">{row.template?.title ?? "—"}</td>
                <td className="max-w-[140px] truncate px-4 py-4 text-zinc-300">{row.list?.name ?? row.segment?.name ?? "—"}</td>
                <td className="max-w-[120px] truncate px-4 py-4 text-zinc-300">{row.smtp?.name ?? "—"}</td>
                <td className="px-4 py-4">
                  <StatusBadge label={getCampaignStatusLabel(row.status)} tone={toneForCampaignStatus(row.status)} />
                </td>
                <td className="px-4 py-4 font-mono text-[11px] leading-relaxed text-zinc-400">
                  <div>T: {fmtInt(row.targetedCount)}</div>
                  <div>G: {fmtInt(row.sentCount)}</div>
                  <div>S: {fmtInt(row.skippedCount)}</div>
                  <div>
                    F: {fmtInt(row.failedCount)} · K: {fmtInt(row.queuedCount)}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="w-32">
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                        style={{ width: `${Math.max(0, Math.min(100, row.progress))}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] tabular-nums text-zinc-500">{row.progress}%</p>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-xs text-zinc-500">{fmtDate(row.lastActivity)}</td>
                <td className="px-4 py-4 pr-5 text-right">
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
      <footer className="flex flex-col gap-3 border-t border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-xs text-zinc-500">
          <span className="font-medium text-zinc-300">{fmtInt(total)}</span> kampanya · Sayfa{" "}
          <span className="tabular-nums text-zinc-300">{page}</span> / {totalPages}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={`${pageSize}`}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
          >
            <option value="25">25 / sayfa</option>
            <option value="50">50 / sayfa</option>
            <option value="100">100 / sayfa</option>
          </select>
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-40"
          >
            Önceki
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-40"
          >
            Sonraki
          </button>
        </div>
      </footer>
    </section>
  );
}
