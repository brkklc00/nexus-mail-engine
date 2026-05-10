"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

export function CampaignDashboardHeader() {
  return (
    <header className="flex flex-col gap-4 border-b border-white/[0.06] pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Kampanyalar</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
          Canlı kampanya operasyonu, kuyruk izleme, analiz, raporlama ve durum bazlı işlemler.
        </p>
      </div>
      <Link
        href="/send"
        className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-500 to-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-xl hover:shadow-indigo-500/35"
      >
        <Plus className="h-5 w-5 transition group-hover:scale-110" strokeWidth={2.5} />
        Yeni Kampanya
      </Link>
    </header>
  );
}
