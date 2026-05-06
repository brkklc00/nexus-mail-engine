"use client";

import type { ComponentType } from "react";
import { CheckCircle2, FileText, ListChecks, Mail, MousePointerClick, Send, TriangleAlert, Users } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

type MetricCardItem = {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  tone: "info" | "success" | "warning" | "danger";
};

const METRIC_DEFINITIONS: Array<Omit<MetricCardItem, "value">> = [
  { label: "Sablonlar", icon: FileText, tone: "info" },
  { label: "Listeler", icon: ListChecks, tone: "info" },
  { label: "Alicilar", icon: Users, tone: "info" },
  { label: "Kampanyalar", icon: Mail, tone: "info" },
  { label: "Bugun Gonderilen", icon: Send, tone: "success" },
  { label: "Bugun Basarisiz", icon: TriangleAlert, tone: "danger" },
  { label: "Bugun Acilma", icon: CheckCircle2, tone: "success" },
  { label: "Bugun Tiklama", icon: MousePointerClick, tone: "warning" }
];

export function MetricsCards({
  templates,
  lists,
  recipients,
  campaigns,
  sentToday,
  failedToday,
  opensToday,
  clicksToday
}: {
  templates: number;
  lists: number;
  recipients: number;
  campaigns: number;
  sentToday: number;
  failedToday: number;
  opensToday: number;
  clicksToday: number;
}) {
  const values = [templates, lists, recipients, campaigns, sentToday, failedToday, opensToday, clicksToday];
  const stats: MetricCardItem[] = METRIC_DEFINITIONS.map((metric, index) => ({ ...metric, value: values[index] ?? 0 }));

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((metric) => (
        <article
          key={metric.label}
          className="rounded-2xl border border-border bg-gradient-to-br from-card to-zinc-900/70 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-indigo-400/40"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-zinc-400">{metric.label}</p>
            <metric.icon className="h-4 w-4 text-zinc-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{metric.value.toLocaleString()}</p>
          <StatusBadge label={metric.tone} tone={metric.tone} className="mt-3" />
        </article>
      ))}
    </section>
  );
}
