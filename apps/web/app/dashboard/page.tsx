import { DeliveryChart } from "@/components/dashboard/delivery-chart";
import { PerformanceCharts } from "@/components/dashboard/performance-charts";
import { QueueObservabilityWidget } from "@/components/dashboard/queue-observability-widget";
import { MetricCard } from "@/components/ui/metric-card";

const metrics = [
  { title: "Total Templates", value: 18 },
  { title: "Total Lists", value: 36 },
  { title: "Total Recipients", value: "14,280" },
  { title: "Total Campaigns", value: 104 },
  { title: "Sent Today", value: "42,190", delta: "+12.4%" },
  { title: "Failed Today", value: 392, delta: "-2.1%" },
  { title: "Opens Today", value: "18,927" },
  { title: "Clicks Today", value: "6,103" }
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Command Center</h2>
          <p className="text-sm text-zinc-400">
            Multi-campaign fairness, warmup state, SMTP health and tracking pulse.
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.title} title={metric.title} value={metric.value} delta={metric.delta} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DeliveryChart />
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm text-zinc-300">SMTP Health</h3>
            <p className="mt-2 text-3xl font-semibold text-emerald-400">97.8%</p>
            <p className="mt-1 text-xs text-zinc-400">Aliyun-Primary throttled by warmup tier T6.</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm text-zinc-300">Warmup Summary</h3>
            <p className="mt-2 text-lg text-white">Current tier: 500k/day (~5.79 r/s)</p>
            <p className="mt-1 text-xs text-zinc-400">Next tier in 110,230 successful deliveries.</p>
          </div>
          <QueueObservabilityWidget />
        </div>
      </section>

      <PerformanceCharts />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm text-zinc-300">Top Campaigns</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded bg-zinc-900/70 px-3 py-2">
              <span>Aliyun Spring Launch</span>
              <span className="text-emerald-400">CTOR 18.2%</span>
            </div>
            <div className="flex items-center justify-between rounded bg-zinc-900/70 px-3 py-2">
              <span>VIP Reactivation Wave</span>
              <span className="text-emerald-400">CTOR 16.9%</span>
            </div>
            <div className="flex items-center justify-between rounded bg-zinc-900/70 px-3 py-2">
              <span>Onboarding Sequence</span>
              <span className="text-emerald-400">CTOR 14.5%</span>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm text-zinc-300">Recent Tracking Events</h3>
          <div className="space-y-2 text-xs text-zinc-300">
            <p className="rounded bg-zinc-900/70 px-3 py-2">
              OPEN · camp_122 · rcpt_9912 · Aliyun tier capped at 5.79 r/s
            </p>
            <p className="rounded bg-zinc-900/70 px-3 py-2">
              CLICK · camp_122 · link_03 · target: /pricing/enterprise
            </p>
            <p className="rounded bg-zinc-900/70 px-3 py-2">
              OPEN · camp_120 · rcpt_8121 · provider: smtp-relay-eu
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
