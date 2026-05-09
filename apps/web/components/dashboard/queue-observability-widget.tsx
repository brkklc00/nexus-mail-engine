"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

type QueuePayload = {
  deliveryCounts: Record<string, number>;
  retryCounts: Record<string, number>;
  deadCounts: Record<string, number>;
  latencyMs: number;
  workerConcurrency: number;
  throughputBySmtp: Array<{ smtpAccountId: string; sentLastMinute: number }>;
  throttledStates: Array<{ id: string; name: string; throttleReason: string | null }>;
  sharedSafety: Array<{
    smtpAccountId: string;
    total: number;
    failures: number;
    throttleLevel: number;
    throttledUntil: number;
  }>;
};

type QueueAdminAction =
  | "pause"
  | "resume"
  | "clean_stale_campaign_jobs"
  | "clean_failed"
  | "clean_completed"
  | "clean_campaign_jobs";

type QueueAdminResponse = {
  ok: boolean;
  action?: QueueAdminAction;
  cleaned?: number;
  skippedActive?: number;
  skippedUnknown?: number;
  protectedActiveCampaigns?: string[];
  queueCounts?: {
    campaign?: Record<string, number>;
    delivery?: Record<string, number>;
    retry?: Record<string, number>;
    dead?: Record<string, number>;
  };
  code?: string;
  error?: string;
};

type ConfirmState = {
  open: boolean;
  action: QueueAdminAction | null;
  requiredText: string;
  title: string;
  message: string;
};

export function QueueObservabilityWidget() {
  const [data, setData] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    action: null,
    requiredText: "",
    title: "",
    message: ""
  });
  const [confirmText, setConfirmText] = useState("");
  const [adminLoading, setAdminLoading] = useState<QueueAdminAction | null>(null);
  const [adminResult, setAdminResult] = useState<QueueAdminResponse | null>(null);
  const inFlightRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);

  const pull = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch("/api/observability/queues", { signal: controller.signal });
      if (!response.ok) {
        throw new Error("Kuyruk metrikleri kullanilamiyor");
      }
      const payload = (await response.json()) as QueuePayload;
      setData(payload);
      setError(null);
    } catch (pullError) {
      if (pullError instanceof Error && pullError.name === "AbortError") {
        setError("Yuklenemedi");
      } else {
        setError(pullError instanceof Error ? pullError.message : "Metrik istegi basarisiz oldu");
      }
    } finally {
      window.clearTimeout(timeout);
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void pull();
    const interval = setInterval(() => {
      if (document.hidden) return;
      void pull();
    }, 5000);
    return () => {
      clearInterval(interval);
      requestControllerRef.current?.abort();
    };
  }, [pull]);

  const estimatedWaiting = (data?.deliveryCounts.waiting ?? 0) + (data?.retryCounts.waiting ?? 0);

  async function runAdminAction(action: QueueAdminAction) {
    setAdminLoading(action);
    try {
      const response = await fetch("/api/queue/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          campaignId: action === "clean_campaign_jobs" ? campaignId.trim() : undefined
        })
      });
      const payload = (await response.json().catch(() => ({}))) as QueueAdminResponse;
      setAdminResult(payload);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Kuyruk islemi basarisiz");
      }
      setConfirmState({ open: false, action: null, requiredText: "", title: "", message: "" });
      setConfirmText("");
    } catch (actionError) {
      setAdminResult({
        ok: false,
        error: actionError instanceof Error ? actionError.message : "Kuyruk islemi basarisiz"
      });
    } finally {
      setAdminLoading(null);
    }
  }

  function requestConfirmation(action: QueueAdminAction) {
    if (action === "clean_stale_campaign_jobs") {
      setConfirmState({
        open: true,
        action,
        requiredText: "TEMIZLE",
        title: "Eski/İptal Edilmiş İşleri Temizle",
        message:
          "Bu işlem yalnızca iptal edilmiş, tamamlanmış, başarısız veya silinmiş kampanyalara ait kuyruk işlerini temizler. Aktif kampanyaların kuyrukları korunur."
      });
      return;
    }
    if (action === "clean_campaign_jobs") {
      setConfirmState({
        open: true,
        action,
        requiredText: "KAMPANYA KUYRUGU TEMIZLE",
        title: "Seçili Kampanyanın Kuyruğunu Temizle",
        message:
          "Bu işlem yalnızca seçili kampanya güvenli durumdaysa kuyruk işlerini temizler. Aktif kampanya işleri korunur."
      });
      return;
    }
    void runAdminAction(action);
  }

  return (
    <div className="flex h-full min-h-[460px] flex-col rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm text-zinc-300">Kuyruk Gozlemlenebilirligi</h3>
      {!data && !error ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Kuyruk metrikleri yukleniyor...
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <EmptyState icon="loader" title="Queue verisi alinamadi" description={error} />
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <Stat label="Aktif Isler" value={data?.deliveryCounts.active ?? 0} />
        <Stat label="Bekleyen Isler" value={data?.deliveryCounts.waiting ?? 0} />
        <Stat label="Kuyruk Gecikmesi" value={`${Math.round((data?.latencyMs ?? 0) / 1000)}sn`} />
        <Stat label="Worker Eszamanlilik" value={data?.workerConcurrency ?? 0} />
      </div>
      <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        {(data?.throughputBySmtp ?? []).slice(0, 4).map((item) => (
          <p key={item.smtpAccountId}>
            SMTP {item.smtpAccountId.slice(0, 8)}... : {item.sentLastMinute}/dk
          </p>
        ))}
      </div>
      <div className="mt-3 max-h-32 overflow-y-auto rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        <p className="mb-1 uppercase tracking-wider text-zinc-400">Sinirlama Durumu</p>
        {(data?.throttledStates ?? []).length === 0 ? <p>Sinirlanan SMTP yok.</p> : null}
        {(data?.throttledStates ?? []).map((item) => (
          <div key={item.id} className="mb-1 flex items-center justify-between gap-2">
            <p>{item.name}</p>
            <StatusBadge label={item.throttleReason ?? "sinirlandi"} tone="warning" />
          </div>
        ))}
      </div>
      <div className="mt-3 max-h-28 overflow-y-auto rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
        <p className="mb-1 uppercase tracking-wider text-zinc-400">Paylasilan Guvenlik</p>
        {(data?.sharedSafety ?? []).slice(0, 4).map((item) => (
          <p key={item.smtpAccountId}>
            {item.smtpAccountId?.slice(0, 8)}... lvl={item.throttleLevel} fail={item.failures}/{item.total}
          </p>
        ))}
      </div>

      <div className="mt-3 rounded bg-zinc-900/60 p-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Kuyruk Yonetimi</p>
        <div className="grid grid-cols-1 gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => requestConfirmation("pause")}
              disabled={adminLoading !== null}
              className="rounded border border-border px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
            >
              Kuyrugu Duraklat
            </button>
            <button
              type="button"
              onClick={() => requestConfirmation("resume")}
              disabled={adminLoading !== null}
              className="rounded border border-border px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
            >
              Kuyrugu Devam Ettir
            </button>
          </div>
          <button
            type="button"
            onClick={() => requestConfirmation("clean_stale_campaign_jobs")}
            disabled={adminLoading !== null}
            className="rounded border border-amber-500/40 px-2 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
          >
            Eski/Iptal Edilmis Isleri Temizle
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => requestConfirmation("clean_failed")}
              disabled={adminLoading !== null}
              className="rounded border border-border px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
            >
              Basarisiz Isleri Temizle
            </button>
            <button
              type="button"
              onClick={() => requestConfirmation("clean_completed")}
              disabled={adminLoading !== null}
              className="rounded border border-border px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
            >
              Tamamlanan Isleri Temizle
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              placeholder="Kampanya ID"
              className="rounded border border-border bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              type="button"
              onClick={() => requestConfirmation("clean_campaign_jobs")}
              disabled={adminLoading !== null || campaignId.trim().length === 0}
              className="rounded border border-rose-500/40 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
            >
              Secili Kampanya
            </button>
          </div>
        </div>
      </div>

      {adminResult ? (
        <div className="mt-3 rounded bg-zinc-900/60 p-3 text-xs text-zinc-300">
          <p className="mb-1 uppercase tracking-wider text-zinc-400">Islem Ozeti</p>
          <p>Temizlenen is: {adminResult.cleaned ?? 0}</p>
          <p>Korunan aktif kampanya isi: {adminResult.skippedActive ?? 0}</p>
          <p>Bilinmeyen/atlanmis is: {adminResult.skippedUnknown ?? 0}</p>
          <p>
            Guncel kuyruk bekleyen:{" "}
            {Number(adminResult.queueCounts?.delivery?.waiting ?? 0) + Number(adminResult.queueCounts?.retry?.waiting ?? 0)}
          </p>
          {adminResult.protectedActiveCampaigns?.length ? (
            <p>Korunan aktif kampanya sayisi: {adminResult.protectedActiveCampaigns.length}</p>
          ) : null}
          {!adminResult.ok && adminResult.error ? <p className="mt-1 text-rose-300">{adminResult.error}</p> : null}
        </div>
      ) : null}

      {confirmState.open && confirmState.action ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-zinc-950 p-4">
            <p className="text-sm font-semibold text-white">{confirmState.title}</p>
            <p className="mt-2 text-xs text-zinc-300">{confirmState.message}</p>
            <div className="mt-2 rounded border border-border bg-zinc-900/50 p-2 text-xs text-zinc-400">
              <p>Tahmini bekleyen is: {estimatedWaiting.toLocaleString()}</p>
              <p>Aktif kampanyalar korunur.</p>
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              Onaylamak icin <span className="font-semibold text-zinc-200">{confirmState.requiredText}</span> yazin.
            </p>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              className="mt-2 w-full rounded border border-border bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
              placeholder={confirmState.requiredText}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmState({ open: false, action: null, requiredText: "", title: "", message: "" });
                  setConfirmText("");
                }}
                className="rounded border border-border px-2 py-1.5 text-xs text-zinc-300"
              >
                Vazgec
              </button>
              <button
                type="button"
                disabled={confirmText.trim() !== confirmState.requiredText || adminLoading !== null}
                onClick={() => void runAdminAction(confirmState.action!)}
                className="rounded border border-rose-500/40 px-2 py-1.5 text-xs text-rose-200 disabled:opacity-50"
              >
                {adminLoading ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null} Onayla
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-zinc-900/40 p-2">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}
