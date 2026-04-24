"use client";

import { cn } from "@/lib/utils";

const toneMap: Record<string, string> = {
  success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  danger: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  warning: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  info: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  muted: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
};

export function StatusBadge({
  label,
  tone = "muted",
  className
}: {
  label: string;
  tone?: "success" | "danger" | "warning" | "info" | "muted";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize tracking-wide",
        toneMap[tone],
        className
      )}
    >
      {label}
    </span>
  );
}
