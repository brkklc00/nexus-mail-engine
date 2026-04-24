"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";

type ToastType = "success" | "error" | "warning" | "info";

type ToastItem = {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  durationMs: number;
};

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "info";
};

type ConfirmState = ConfirmOptions & {
  open: boolean;
};

type NotificationContextValue = {
  notify: (params: {
    type: ToastType;
    title: string;
    message?: string;
    durationMs?: number;
  }) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function toastVisual(type: ToastType) {
  if (type === "success") {
    return {
      icon: CircleCheck,
      border: "border-emerald-400/40",
      bg: "bg-emerald-500/10",
      text: "text-emerald-200"
    };
  }
  if (type === "error") {
    return {
      icon: CircleX,
      border: "border-rose-400/40",
      bg: "bg-rose-500/10",
      text: "text-rose-200"
    };
  }
  if (type === "warning") {
    return {
      icon: CircleAlert,
      border: "border-amber-400/40",
      bg: "bg-amber-500/10",
      text: "text-amber-200"
    };
  }
  return {
    icon: Info,
    border: "border-indigo-400/40",
    bg: "bg-indigo-500/10",
    text: "text-indigo-200"
  };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: "",
    message: ""
  });
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const notify = useCallback((params: { type: ToastType; title: string; message?: string; durationMs?: number }) => {
    const item: ToastItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: params.type,
      title: params.title,
      message: params.message,
      durationMs: params.durationMs ?? 3200
    };
    setToasts((prev) => [item, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== item.id));
    }, item.durationMs);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setConfirmState({
      open: true,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      tone: options.tone
    });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[110] flex w-[360px] max-w-[calc(100vw-1rem)] flex-col gap-2">
        {toasts.map((toast) => {
          const visual = toastVisual(toast.type);
          const Icon = visual.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-xl border px-3 py-2 shadow-xl backdrop-blur ${visual.border} ${visual.bg}`}
            >
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 ${visual.text}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${visual.text}`}>{toast.title}</p>
                  {toast.message ? <p className="mt-0.5 text-xs text-zinc-300">{toast.message}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((entry) => entry.id !== toast.id))}
                  className="text-zinc-400 hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel={confirmState.cancelLabel}
        tone={confirmState.tone}
        onConfirm={() => {
          setConfirmState((prev) => ({ ...prev, open: false }));
          resolverRef.current?.(true);
          resolverRef.current = null;
        }}
        onCancel={() => {
          setConfirmState((prev) => ({ ...prev, open: false }));
          resolverRef.current?.(false);
          resolverRef.current = null;
        }}
      />
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification must be used inside NotificationProvider");
  }
  return context;
}

export function useToast() {
  const { notify } = useNotification();
  return {
    success: (title: string, message?: string) => notify({ type: "success", title, message }),
    error: (title: string, message?: string) => notify({ type: "error", title, message }),
    warning: (title: string, message?: string) => notify({ type: "warning", title, message }),
    info: (title: string, message?: string) => notify({ type: "info", title, message })
  };
}

export function useConfirm() {
  const { confirm } = useNotification();
  return confirm;
}
