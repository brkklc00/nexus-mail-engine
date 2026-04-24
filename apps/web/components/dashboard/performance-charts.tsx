"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { EmptyState } from "@/components/ui/empty-state";

export function PerformanceCharts({
  rateData,
  failureData
}: {
  rateData: Array<{ day: string; openRate: number; clickRate: number }>;
  failureData: Array<{ name: string; value: number }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="h-72 rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-sm text-zinc-300">Open / Click Rate</p>
        {rateData.length === 0 ? (
          <EmptyState
            icon="chart-pie"
            title="Rate trend verisi yok"
            description="Kampanya open/click oranlari olustukca haftalik trend burada listelenir."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rateData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="day" stroke="#71717a" />
              <YAxis stroke="#71717a" />
              <Tooltip />
              <Area dataKey="openRate" stroke="#6e7dff" fill="#6e7dff33" />
              <Area dataKey="clickRate" stroke="#17c964" fill="#17c96433" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="h-72 rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-sm text-zinc-300">Failure Reasons</p>
        {failureData.length === 0 ? (
          <EmptyState
            icon="chart-pie"
            title="Failure verisi yok"
            description="Failed event message'lari biriktikce dagilim burada gosterilir."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={failureData}
                dataKey="value"
                nameKey="name"
                outerRadius={100}
                fill="#6e7dff"
                label
              />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
