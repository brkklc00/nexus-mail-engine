"use client";

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
  const noEngagement = engagementData.every((item) => item.opens === 0 && item.clicks === 0 && item.openRate === 0 && item.clickRate === 0);
  const totalFailures = failureData.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Performance Analytics</p>
          <p className="text-xs text-zinc-400">Delivery, engagement and failure trends for recent campaigns.</p>
        </div>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 text-xs">
          {[
            { id: "today", label: "Today" },
            { id: "7d", label: "7 days" },
            { id: "30d", label: "30 days" }
          ].map((item) => (
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
            <span>Delivery Trend</span>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-indigo-400" />Sent</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-400" />Failed</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-300" />Skipped</span>
            </div>
          </div>
          {deliveryData.every((item) => item.sent === 0 && item.failed === 0 && item.skipped === 0) ? (
            <div className="flex h-[235px] items-center justify-center">
              <EmptyState icon="chart-bar" title="No delivery data yet." description="Delivery trend appears as events accumulate." />
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
          <div className="mb-2 text-xs text-zinc-400">Engagement Trend</div>
          {noEngagement ? (
            <div className="flex h-[235px] items-center justify-center">
              <EmptyState
                icon="chart-pie"
                title="No engagement data yet."
                description="Open/click tracking will appear here after recipients interact."
              />
            </div>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">Opens: {engagementData.reduce((s, i) => s + i.opens, 0)}</div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">Clicks: {engagementData.reduce((s, i) => s + i.clicks, 0)}</div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">
                  Open Rate: {Number((engagementData.reduce((s, i) => s + i.openRate, 0) / engagementData.length).toFixed(2))}%
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">
                  Click Rate: {Number((engagementData.reduce((s, i) => s + i.clickRate, 0) / engagementData.length).toFixed(2))}%
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
          <div className="mb-2 text-xs text-zinc-400">Failure Breakdown</div>
          {totalFailures === 0 ? (
            <div className="flex h-[235px] items-center justify-center">
              <EmptyState icon="chart-pie" title="No failures recorded." description="Failure trends appear here when delivery fails." />
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
