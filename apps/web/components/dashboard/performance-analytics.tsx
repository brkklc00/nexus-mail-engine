import dynamic from "next/dynamic";

const PerformanceCharts = dynamic(
  () => import("@/components/dashboard/performance-charts").then((mod) => mod.PerformanceCharts),
  {
    loading: () => (
      <section className="rounded-2xl border border-zinc-800/80 bg-card p-4 text-sm text-zinc-400">
        Performans analitigi yukleniyor...
      </section>
    )
  }
);

export function PerformanceAnalytics({
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
  return (
    <PerformanceCharts
      deliveryData={deliveryData}
      engagementData={engagementData}
      failureData={failureData}
      range={range}
    />
  );
}
