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

const rateData = [
  { day: "Mon", openRate: 31.2, clickRate: 8.9 },
  { day: "Tue", openRate: 33.5, clickRate: 9.8 },
  { day: "Wed", openRate: 34.1, clickRate: 9.5 },
  { day: "Thu", openRate: 36.8, clickRate: 10.3 },
  { day: "Fri", openRate: 35.7, clickRate: 10.1 },
  { day: "Sat", openRate: 32.1, clickRate: 8.7 },
  { day: "Sun", openRate: 30.4, clickRate: 7.9 }
];

const failureData = [
  { name: "Timeout", value: 32 },
  { name: "TempFail", value: 21 },
  { name: "Blocked", value: 17 },
  { name: "InvalidRcpt", value: 11 },
  { name: "Suppressed", value: 19 }
];

export function PerformanceCharts() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="h-72 rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-sm text-zinc-300">Open / Click Rate</p>
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
      </div>
      <div className="h-72 rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-sm text-zinc-300">Failure Reasons</p>
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
      </div>
    </div>
  );
}
