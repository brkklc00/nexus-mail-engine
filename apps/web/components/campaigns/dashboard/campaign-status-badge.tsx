"use client";

import { cn } from "@/lib/utils";
import { getCampaignStatusLabel } from "./campaign-dashboard-utils";

const statusClass: Record<string, string> = {
  running:
    "border-emerald-400/55 bg-emerald-500/[0.22] text-emerald-100 shadow-[0_0_14px_-4px_rgba(52,211,153,0.45)]",
  completed:
    "border-emerald-400/50 bg-emerald-500/[0.18] text-emerald-50 shadow-[0_0_12px_-4px_rgba(16,185,129,0.35)]",
  partially_completed:
    "border-violet-400/50 bg-gradient-to-r from-indigo-500/30 to-violet-600/25 text-violet-50 shadow-[0_0_16px_-4px_rgba(139,92,246,0.4)]",
  paused:
    "border-amber-400/60 bg-amber-500/[0.2] text-amber-50 shadow-[0_0_12px_-4px_rgba(251,191,36,0.3)]",
  pending:
    "border-amber-400/45 bg-amber-500/15 text-amber-100",
  queued: "border-amber-400/45 bg-amber-500/15 text-amber-100",
  failed:
    "border-rose-400/55 bg-rose-500/[0.2] text-rose-50 shadow-[0_0_12px_-4px_rgba(251,113,133,0.35)]",
  canceled:
    "border-rose-500/50 bg-rose-500/[0.18] text-rose-50 shadow-[0_0_10px_-4px_rgba(239,68,68,0.25)]"
};

export function CampaignStatusBadge({ status }: { status: string }) {
  const cls = statusClass[status] ?? "border-[#3d4a63] bg-[#1a2233] text-zinc-200";
  return (
    <span
      className={cn(
        "inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide",
        cls
      )}
    >
      {getCampaignStatusLabel(status)}
    </span>
  );
}
