"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/ui/empty-state";

export function DeliveryChart({
  chartData
}: {
  chartData: Array<{ hour: string; sent: number; failed: number }>;
}) {
  if (chartData.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <EmptyState
          icon="chart-bar"
          title="No data for delivery chart"
          description="Bugune ait sent/failed event olustugunda saatlik dagilim burada gorunecek."
        />
      </div>
    );
  }

  return (
    <div className="h-72 rounded-lg border border-border bg-card p-4">
      <p className="mb-3 text-sm text-zinc-300">Delivery Overview</p>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <XAxis dataKey="hour" stroke="#71717a" />
          <YAxis stroke="#71717a" />
          <Tooltip />
          <Bar dataKey="sent" fill="#6e7dff" radius={[4, 4, 0, 0]} />
          <Bar dataKey="failed" fill="#f31260" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
