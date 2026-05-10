"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, FileDown, Loader2, MoreVertical, Pause, Play, Rocket, SquareX, Trash2 } from "lucide-react";
import type { CampaignRow, CampaignStatus } from "./campaign-dashboard-types";
import { availableCampaignRowActions } from "./campaign-dashboard-utils";

type Action = "start" | "pause" | "resume" | "cancel" | "report" | "delete" | "view";

const labels: Record<Action, string> = {
  start: "Başlat",
  pause: "Duraklat",
  resume: "Devam Ettir",
  cancel: "İptal Et",
  report: "Rapor",
  delete: "Sil",
  view: "Görüntüle"
};

export function CampaignRowActionsMenu({
  row,
  pendingAction,
  onView,
  onReport,
  onAction
}: {
  row: CampaignRow;
  pendingAction: string | null;
  onView: () => void;
  onReport: () => void;
  onAction: (action: "start" | "pause" | "resume" | "cancel" | "delete") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const actions = availableCampaignRowActions(row.status as CampaignStatus);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!open) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  return (
    <div className="relative flex items-center justify-end gap-2" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => {
          onView();
          setOpen(false);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:border-indigo-400/50 hover:bg-indigo-500/15"
      >
        <Eye className="h-3.5 w-3.5" />
        Görüntüle
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
        aria-label="İşlemler menüsü"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 py-1 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {actions
            .filter((a) => a !== "view")
            .map((a) => {
              const rowBusy = pendingAction !== null;
              const danger = a === "cancel" || a === "delete";
              const Icon =
                a === "start"
                  ? Rocket
                  : a === "pause"
                    ? Pause
                    : a === "resume"
                      ? Play
                      : a === "cancel"
                        ? SquareX
                        : a === "report"
                          ? FileDown
                          : Trash2;
              return (
                <button
                  key={a}
                  type="button"
                  disabled={rowBusy}
                  onClick={() => {
                    setOpen(false);
                    if (a === "report") onReport();
                    else onAction(a);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition disabled:opacity-50 ${
                    danger ? "text-rose-300 hover:bg-rose-500/10" : "text-zinc-200 hover:bg-zinc-900"
                  }`}
                >
                  {pendingAction === `${row.id}:${a}` ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {labels[a]}
                </button>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}
