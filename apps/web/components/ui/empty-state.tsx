"use client";

import {
  Activity,
  Ban,
  BarChart3,
  FileQuestion,
  Filter,
  FolderPlus,
  Loader2,
  MailPlus,
  Megaphone,
  PieChart,
  ServerCog
} from "lucide-react";

type EmptyStateIcon =
  | "activity"
  | "ban"
  | "chart-bar"
  | "chart-pie"
  | "filter"
  | "folder-plus"
  | "loader"
  | "mail-plus"
  | "megaphone"
  | "server";

const iconMap = {
  activity: Activity,
  ban: Ban,
  "chart-bar": BarChart3,
  "chart-pie": PieChart,
  filter: Filter,
  "folder-plus": FolderPlus,
  loader: Loader2,
  "mail-plus": MailPlus,
  megaphone: Megaphone,
  server: ServerCog
} satisfies Record<EmptyStateIcon, React.ComponentType<{ className?: string }>>;

export function EmptyState({
  icon = "activity",
  title,
  description,
  ctaLabel
}: {
  icon?: EmptyStateIcon;
  title: string;
  description: string;
  ctaLabel?: string;
}) {
  const Icon = iconMap[icon] ?? FileQuestion;

  return (
    <div className="rounded-2xl border border-dashed border-border bg-gradient-to-b from-zinc-900/70 to-zinc-950/70 p-6 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-zinc-900 text-zinc-300">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
      {ctaLabel ? (
        <button
          type="button"
          disabled
          className="mt-4 rounded-lg border border-border px-3 py-2 text-xs text-zinc-400 disabled:cursor-not-allowed"
          title="Backend endpoint is required for this action"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}
