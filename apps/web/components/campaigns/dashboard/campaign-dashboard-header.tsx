"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { campaignTheme } from "./campaign-theme";

export function CampaignDashboardHeader() {
  return (
    <header className={`flex flex-col gap-4 border-b pb-8 sm:flex-row sm:items-end sm:justify-between ${campaignTheme.border}`}>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Kampanyalar</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
          Canlı kampanya operasyonu, kuyruk izleme, analiz, raporlama ve durum bazlı işlemler.
        </p>
      </div>
      <Link
        href="/send"
        className={`group inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/40 transition ${campaignTheme.primaryGradient} ${campaignTheme.primaryGradientHover}`}
      >
        <Plus className="h-5 w-5 transition group-hover:scale-110" strokeWidth={2.5} />
        Yeni Kampanya
      </Link>
    </header>
  );
}
