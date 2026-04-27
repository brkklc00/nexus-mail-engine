"use client";

import { OverlayPortal } from "@/components/ui/overlay-portal";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "info";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  if (!open) return null;

  const toneClass =
    tone === "danger"
      ? "bg-rose-500 hover:bg-rose-400"
      : tone === "warning"
        ? "bg-amber-500 hover:bg-amber-400"
        : "bg-indigo-500 hover:bg-indigo-400";

  return (
    <OverlayPortal active={open} lockScroll>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="relative z-[60] w-full max-w-md rounded-2xl border border-border/80 bg-[#0f1420] p-5 shadow-2xl">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-2 text-sm text-zinc-300">{message}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200"
              disabled={loading}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60 ${toneClass}`}
            >
              {loading ? "Please wait..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
