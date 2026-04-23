"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const chartData = [
  { hour: "00", sent: 1200, failed: 60 },
  { hour: "04", sent: 1900, failed: 70 },
  { hour: "08", sent: 2800, failed: 95 },
  { hour: "12", sent: 4100, failed: 120 },
  { hour: "16", sent: 4800, failed: 138 },
  { hour: "20", sent: 3200, failed: 90 }
];

export function DeliveryChart() {
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
