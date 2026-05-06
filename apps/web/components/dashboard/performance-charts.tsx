"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { EmptyState } from "@/components/ui/empty-state";

const RANGE_OPTIONS = [
  { id: "today", label: "Bugun" },
  { id: "7d", label: "7 gun" },
  { id: "30d", label: "30 gun" }
] as const;

export function PerformanceCharts({
  deliveryData,
  engagementData,
  failureData,
  range
}: {
  deliveryData: Array<{ label: string; sent: number; failed: number; skipped: number }>;
  engagementData: Array<{ label: string; opens: number; clicks: number; openRate: number; clickRate: number }>;
  failureData: Array<{ reason: string; count: number; percentage: number }>;
  range: "today" | "7d" | "30d";
}) {
  const noEngagement = useMemo(
    () => engagementData.every((item) => item.opens === 0 && item.clicks === 0 && item.openRate === 0 && item.clickRate === 0),
    [engagementData]
  );
  const totalFailures = useMemo(() => failureData.reduce((sum, item) => sum + item.count, 0), [failureData]);
  const engagementSummary = useMemo(() => {
    if (engagementData.length === 0) {
      return { opens: 0, clicks: 0, averageOpenRate: 0, averageClickRate: 0 };
    }
    const opens = engagementData.reduce((sum, item) => sum + item.opens, 0);
    const clicks = engagementData.reduce((sum, item) => sum + item.clicks, 0);
    const averageOpenRate = Number((engagementData.reduce((sum, item) => sum + item.openRate, 0) / engagementData.length).toFixed(2));
    const averageClickRate = Number((engagementData.reduce((sum, item) => sum + item.clickRate, 0) / engagementData.length).toFixed(2));
    return { opens, clicks, averageOpenRate, averageClickRate };
  }, [engagementData]);

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Performans Analitigi</p>
          <p className="text-xs text-zinc-400">Son kampanyalar icin teslimat, etkilesim ve basarisizlik trendleri.</p>
        </div>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 text-xs">
          {RANGE_OPTIONS.map((item) => (
            <a
              key={item.id}
              href={`/dashboard?${new URLSearchParams({ analyticsRange: item.id }).toString()}`}
              className={`rounded-md px-2.5 py-1 transition ${
                range === item.id ? "bg-indigo-500/20 text-indigo-200" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article className="min-h-[260px] max-h-[320px] rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
            <span>Teslimat Trendi</span>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-indigo-400" />Gonderildi</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-400" />Basarisiz</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-300" />Atlandi</span>
            </div>
          </div>
          {deliveryData.every((item) => item.sent === 0 && item.failed === 0 && item.skipped === 0) ? (
            <div className="flex h-[235px] items-center justify-center">
              <EmptyState icon="chart-bar" title="Henüz teslimat verisi yok." description="Teslimat trendi veriler biriktikçe gorunur." />
            </div>
          ) : (
            <div className="h-[235px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={deliveryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="label" stroke="#71717a" tickLine={false} axisLine={false} />
                  <YAxis stroke="#71717a" tickLine={false} axisLine={false} width={30} />
                  <Tooltip />
                  <Line type="monotone" dataKey="sent" stroke="#818cf8" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="failed" stroke="#fb7185" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="skipped" stroke="#fbbf24" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="min-h-[260px] max-h-[320px] rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
          <div className="mb-2 text-xs text-zinc-400">Etkilesim Trendi</div>
          {noEngagement ? (
            <div className="flex h-[235px] items-center justify-center">
              <EmptyState
                icon="chart-pie"
                title="Henuz etkilesim verisi yok."
                description="Alicilar etkilesime girdikten sonra acilma/tiklama verisi burada gorunur."
              />
            </div>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">Acilma: {engagementSummary.opens}</div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">Tiklama: {engagementSummary.clicks}</div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">
                  Acilma Orani: {engagementSummary.averageOpenRate}%
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">
                  Tiklama Orani: {engagementSummary.averageClickRate}%
                </div>
              </div>
              <div className="h-[190px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={engagementData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" stroke="#71717a" tickLine={false} axisLine={false} />
                    <YAxis stroke="#71717a" tickLine={false} axisLine={false} width={30} />
                    <Tooltip />
                    <Line type="monotone" dataKey="openRate" stroke="#60a5fa" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="clickRate" stroke="#34d399" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </article>

        <article className="min-h-[260px] max-h-[320px] rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
          <div className="mb-2 text-xs text-zinc-400">Basarisizlik Dagilimi</div>
          {totalFailures === 0 ? (
            <div className="flex h-[235px] items-center justify-center">
              <EmptyState icon="chart-pie" title="Basarisizlik kaydi yok." description="Gonderim basarisiz oldugunda trendler burada gorunur." />
            </div>
          ) : (
            <div className="space-y-2">
              {failureData.slice(0, 6).map((item) => (
                <div key={item.reason} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <p className="truncate text-zinc-300">{item.reason}</p>
                    <p className="text-zinc-400">{item.count} ({item.percentage}%)</p>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-zinc-800">
                    <div className="h-1.5 rounded bg-rose-400" style={{ width: `${Math.max(2, item.percentage)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
