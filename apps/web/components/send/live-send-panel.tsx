"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pause, Play, Rocket, StopCircle } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type BootstrapData = {
  ok?: boolean;
  templates: Array<{ id: string; title: string; status?: string; warning?: string | null }>;
  lists: Array<{ id: string; name: string; estimatedRecipients: number }>;
  smtpAccounts?: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    encryption: string;
    username: string;
    fromEmail: string;
    providerLabel: string | null;
    isActive: boolean;
    targetRatePerSecond: number;
    maxRatePerSecond: number | null;
    isThrottled: boolean;
    healthStatus?: string | null;
    warning?: string | null;
  }>;
  campaigns: Array<{ id: string; name: string; status: string }>;
  segments: Array<{ id: string; name: string; lastMatchedCount: number; updatedAt: string }>;
  poolSettings?: {
    rotateEvery?: number;
    parallelSmtpLanes?: number;
    parallelSmtpCount?: number;
    sendingMode?: "single" | "pool";
    useAllActiveByDefault?: boolean;
    skipThrottled?: boolean;
    skipUnhealthy?: boolean;
  } | null;
  defaults?: {
    targetType?: "list" | "saved_segment" | "ad_hoc_segment";
    smtpMode?: "single" | "pool";
    strategy?: "round_robin" | "rotate_every_n" | "weighted_warmup" | "least_used" | "health_based";
    rotateEvery?: number;
    parallelSmtpCount?: number;
  };
};

type LiveEvent = {
  campaignId: string;
  status: string;
  progress: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  currentRate: number;
  effectiveRate: number;
  throttleReason?: string | null;
  warmupTier?: string;
  warmupNextTier?: string;
  activeSmtps?: Array<{ id: string; name: string }>;
  currentRotation?: string;
  perSmtpSent?: Array<{ smtpAccountId: string; smtpName: string; sent: number }>;
  queue?: { waiting: number; active: number; failed: number };
  targetTotalRps?: number;
  dailyTarget?: number;
  activeLaneCount?: number;
  throttledSmtpCount?: number;
  eligibleSmtpCount?: number;
  avgPerSmtpRps?: number;
  targetPerSmtpRps?: number;
  warmupCapTotalRps?: number;
  throttleCapTotalRps?: number;
  providerCapTotalRps?: number;
  warmupBottleneckSmtpCount?: number;
  warmupAvgCapRps?: number;
  expectedRpsAfterApply?: number;
  dbPendingRecipients?: number;
  dbProcessingRecipients?: number;
  dbSentRecipients?: number;
  dbFailedRecipients?: number;
  dbSkippedRecipients?: number;
  redisWaitingJobs?: number;
  redisActiveJobs?: number;
  schedulerBatchSize?: number;
  lastSchedulerEnqueued?: number;
  lastSchedulerReason?: string;
  bottleneckReason?: string;
};

export function LiveSendPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [live, setLive] = useState<LiveEvent | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showActiveSmtps, setShowActiveSmtps] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<null | "create" | "pause" | "resume" | "cancel">(null);
  const [form, setForm] = useState({
    name: "Nexus Test Campaign",
    templateId: "",
    listId: "",
    targetMode: "list" as "list" | "saved_segment" | "ad_hoc_segment",
    segmentId: "",
    adHocDomain: "",
    adHocOpened: false,
    adHocClicked: false,
    adHocFailed: false,
    adHocSuppressed: false,
    rotateEvery: 500,
    strategy: "round_robin" as "round_robin" | "rotate_every_n" | "weighted_warmup" | "least_used" | "health_based"
  });

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/send/bootstrap", { cache: "no-store" });
        const rawBody = await response.text();
        let parsed: any = {};
        try {
          parsed = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          parsed = { error: rawBody || "Non-JSON response" };
        }
        if (!response.ok || parsed?.ok === false) {
          const reason = parsed?.reason ?? parsed?.error ?? "Bootstrap request failed";
          console.error("[send.bootstrap] failed", {
            status: response.status,
            body: parsed
          });
          throw new Error(`HTTP ${response.status}: ${reason}`);
        }
        const data = parsed as BootstrapData;
        const smtpAccounts = Array.isArray(data.smtpAccounts) ? data.smtpAccounts : [];
        const safeTemplates = Array.isArray(data.templates) ? data.templates : [];
        const safeLists = Array.isArray(data.lists) ? data.lists : [];
        const safeSegments = Array.isArray(data.segments) ? data.segments : [];
        const safeSmtps = smtpAccounts;

        const firstTemplate = safeTemplates.find((item) => item.status === "active")?.id ?? safeTemplates[0]?.id ?? "";
        const firstList = safeLists.find((item) => item.estimatedRecipients > 0)?.id ?? safeLists[0]?.id ?? "";
        const firstSegment = safeSegments[0]?.id ?? "";
        const skipThrottled = data.poolSettings?.skipThrottled ?? true;
        const skipUnhealthy = data.poolSettings?.skipUnhealthy ?? true;
        setBootstrap(data);
        setBootstrapError(null);
        setForm((prev) => ({
          ...prev,
          targetMode: data.defaults?.targetType ?? "list",
          templateId: firstTemplate,
          listId: firstList,
          segmentId: firstSegment,
          rotateEvery: Number(data.defaults?.rotateEvery ?? data.poolSettings?.rotateEvery ?? 500),
          strategy: data.defaults?.strategy ?? "round_robin"
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Request failed";
        setBootstrapError(message);
        toast.error("Gonderim hazirlik verisi alinamadi", message || "Hazirlik verisi yuklenemedi.");
      } finally {
        setLoadingBootstrap(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    const source = new EventSource(`/send/stream?campaignId=${campaignId}`);
    let previous: LiveEvent | null = null;
    source.addEventListener("progress", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data) as LiveEvent;
      setLive(payload);
      const nextLogs: string[] = [];
      if (!previous) {
        nextLogs.push("campaign_started");
      } else {
        if ((payload.activeLaneCount ?? 0) > (previous.activeLaneCount ?? 0)) {
          nextLogs.push(`lane_started (+${(payload.activeLaneCount ?? 0) - (previous.activeLaneCount ?? 0)})`);
        }
        const sentDelta = (payload.sent ?? 0) - (previous.sent ?? 0);
        if (sentDelta > 0) nextLogs.push(`sent (+${sentDelta})`);
        const failedDelta = (payload.failed ?? 0) - (previous.failed ?? 0);
        if (failedDelta > 0) nextLogs.push(`failed (+${failedDelta})`);
        if (Math.abs((payload.effectiveRate ?? 0) - (previous.effectiveRate ?? 0)) >= 0.2) {
          nextLogs.push(`rate_updated (${Number(payload.effectiveRate ?? 0).toFixed(2)}/s)`);
        }
        if (payload.bottleneckReason === "warmup_cap" && previous.bottleneckReason !== "warmup_cap") {
          nextLogs.push("warmup_cap_detected");
        }
        if (payload.throttleReason && payload.throttleReason !== previous.throttleReason) {
          nextLogs.push(`throttle_applied (${payload.throttleReason})`);
        }
      }
      if (nextLogs.length > 0) {
        setLogs((prev) => [...nextLogs, ...prev].slice(0, 20));
      }
      previous = payload;
    });
    source.addEventListener("done", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data) as { status: string };
      setLogs((prev) => [`campaign finished: ${payload.status}`, ...prev]);
      source.close();
    });
    return () => source.close();
  }, [campaignId]);

  const progressWidth = useMemo(() => `${Math.min(100, Math.max(0, live?.progress ?? 0))}%`, [live]);
  const campaignStatus = live?.status ?? "idle";
  const canPause = campaignStatus === "running";
  const canResume = campaignStatus === "paused";
  const canCancel = ["running", "paused", "queued", "pending"].includes(campaignStatus);
  const templateOptions = bootstrap?.templates ?? [];
  const listOptions = bootstrap?.lists ?? [];
  const segmentOptions = bootstrap?.segments ?? [];
  const smtpAccounts = bootstrap?.smtpAccounts ?? [];
  const activeSmtpOptions = smtpAccounts.filter((smtp) => smtp.isActive !== false);
  const skipThrottled = bootstrap?.poolSettings?.skipThrottled ?? true;
  const skipUnhealthy = bootstrap?.poolSettings?.skipUnhealthy ?? true;
  const usableSmtpOptions = activeSmtpOptions
    .filter((smtp) => (skipThrottled ? !smtp.isThrottled : true))
    .filter((smtp) => (skipUnhealthy ? smtp.healthStatus !== "error" : true));
  const selectedList = bootstrap?.lists.find((list) => list.id === form.listId) ?? null;
  const selectedSegment = bootstrap?.segments.find((segment) => segment.id === form.segmentId) ?? null;
  const selectedTemplate = templateOptions.find((item) => item.id === form.templateId) ?? null;
  const estimatedRate = usableSmtpOptions.reduce(
    (sum, smtp) => sum + (smtp.maxRatePerSecond ?? smtp.targetRatePerSecond ?? 0),
    0
  );
  const targetEmpty =
    form.targetMode === "list"
      ? !form.listId
      : form.targetMode === "saved_segment"
        ? !form.segmentId
        : !form.adHocDomain && !form.adHocOpened && !form.adHocClicked && !form.adHocFailed && !form.adHocSuppressed;
  const estimatedTarget =
    form.targetMode === "list" ? selectedList?.estimatedRecipients ?? 0 : selectedSegment?.lastMatchedCount ?? 0;
  const targetZero =
    form.targetMode === "list"
      ? Boolean(form.listId) && estimatedTarget <= 0
      : form.targetMode === "saved_segment"
        ? Boolean(form.segmentId) && estimatedTarget <= 0
        : false;
  const noTemplate = !form.templateId;
  const noUsableSmtp = usableSmtpOptions.length === 0;

  async function createAndStartCampaign() {
    if (noTemplate) {
      toast.warning("Sablon gerekli", "Baslatmadan once bir sablon secin.");
      return;
    }
    if (targetEmpty) {
      toast.warning("Hedef gerekli", "Liste/segment secin veya ad-hoc filtreleri ayarlayin.");
      return;
    }
    if (targetZero) {
      toast.warning("Hedefte alici yok", "Secilen hedefte alici bulunmuyor.");
      return;
    }
    if (noUsableSmtp) {
      toast.warning("Kullanilabilir SMTP havuzu yok", "Mevcut global havuz guvenlik filtrelerine uygun aktif SMTP hesabi bulunamadi.");
      return;
    }
    const confirmed = await confirm({
        title: "Bu kampanya baslatilsin mi?",
      message: `Kampanya Adi: ${form.name}\nSablon: ${selectedTemplate?.title ?? "-"}\nHedef: ${form.targetMode === "list" ? selectedList?.name ?? "-" : form.targetMode === "saved_segment" ? selectedSegment?.name ?? "-" : "Ad-hoc segment"}\nTahmini alici sayisi: ${estimatedTarget.toLocaleString()}\nTahmini hiz: ${estimatedRate.toFixed(2)}/s\n\nBu kampanya ${usableSmtpOptions.length} uygun SMTP ile paralel gönderilecek.`,
        confirmLabel: "Olustur ve Baslat",
        cancelLabel: "Iptal",
      tone: "warning"
    });
    if (!confirmed) return;

    setActionLoading("create");
    try {
      const createRes = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          templateId: form.templateId,
          targetMode: form.targetMode,
          listId: form.targetMode === "list" ? form.listId : undefined,
          segmentId: form.targetMode === "saved_segment" ? form.segmentId : undefined,
          segmentQueryConfig:
            form.targetMode === "ad_hoc_segment"
              ? {
                  emailDomain: form.adHocDomain || null,
                  engagement: {
                    opened: form.adHocOpened || undefined,
                    clicked: form.adHocClicked || undefined
                  },
                  delivery: [
                    ...(form.adHocFailed ? (["failed"] as const) : []),
                    ...(form.adHocSuppressed ? (["suppressed"] as const) : [])
                  ]
                }
              : undefined,
          smtpMode: "pool",
          rotateEvery: form.rotateEvery,
          strategy: form.strategy
        })
      });
      if (!createRes.ok) {
        const err = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Campaign create failed");
      }
      const created = (await createRes.json()) as { campaign: { id: string } };
      const startRes = await fetch(`/api/campaigns/${created.campaign.id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const err = (await startRes.json().catch(() => ({}))) as { error?: string; code?: string };
        throw new Error(err.error ?? err.code ?? "Campaign start failed");
      }
      setCampaignId(created.campaign.id);
      setLogs((prev) => [`campaign created + started: ${created.campaign.id}`, ...prev]);
      toast.success("Kampanya baslatildi");
    } catch (error) {
      toast.error("Kampanya baslatilamadi", error instanceof Error ? error.message : "Islem basarisiz oldu");
    } finally {
      setActionLoading(null);
    }
  }

  async function action(kind: "pause" | "resume" | "cancel") {
    if (!campaignId) return;
    if (kind === "cancel") {
      const accepted = await confirm({
        title: "Bu kampanya iptal edilsin mi?",
        message: "Bekleyen gonderimler atlandi olarak isaretlenecek.",
        confirmLabel: "Kampanyayi Iptal Et",
        cancelLabel: "Vazgec",
        tone: "danger"
      });
      if (!accepted) return;
    }
    setActionLoading(kind);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${kind}`, { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? `${kind} failed`);
      }
      if (kind === "cancel") {
        toast.info("Kampanya iptal edildi. Bekleyen alicilarin islemi durdurulacak.");
      } else {
        toast.info(`Campaign ${kind} request accepted`);
      }
    } catch (error) {
      toast.error(`Kampanya islemi basarisiz: ${kind}`, error instanceof Error ? error.message : `${kind} basarisiz`);
    } finally {
      setActionLoading(null);
    }
  }

  if (loadingBootstrap) {
    return (
      <div className="space-y-3">
        <div className="h-10 animate-pulse rounded-lg bg-zinc-900/70" />
        <div className="h-10 animate-pulse rounded-lg bg-zinc-900/70" />
        <div className="h-10 animate-pulse rounded-lg bg-zinc-900/70" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Kampanya Adi</span>
          <input
            className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="Kampanya adi"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Sablon</span>
          <select
            className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
            value={form.templateId}
            onChange={(e) => setForm((s) => ({ ...s, templateId: e.target.value }))}
            disabled={templateOptions.length === 0}
          >
            {templateOptions.length === 0 ? <option value="">Aktif sablon yok</option> : null}
            {templateOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}{t.status === "draft" ? " (taslak)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Hedef Turu</span>
          <select
            className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
            value={form.targetMode}
            onChange={(e) => setForm((s) => ({ ...s, targetMode: e.target.value as "list" | "saved_segment" | "ad_hoc_segment" }))}
          >
            <option value="list">Alici listesi</option>
            <option value="saved_segment">Kayitli segment</option>
            <option value="ad_hoc_segment">Ad-hoc segment sorgusu</option>
          </select>
        </label>
        {form.targetMode === "list" ? (
          <label className="space-y-1">
            <span className="text-xs text-zinc-400">Alici Listesi / Segment</span>
            <select
              className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
              value={form.listId}
              onChange={(e) => setForm((s) => ({ ...s, listId: e.target.value }))}
              disabled={listOptions.length === 0}
            >
              {listOptions.length === 0 ? <option value="">Kullanilabilir liste yok</option> : null}
              {listOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {form.targetMode === "saved_segment" ? (
          <label className="space-y-1">
            <span className="text-xs text-zinc-400">Alici Listesi / Segment</span>
            <select
              className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
              value={form.segmentId}
              onChange={(e) => setForm((s) => ({ ...s, segmentId: e.target.value }))}
              disabled={segmentOptions.length === 0}
            >
              {segmentOptions.length === 0 ? <option value="">Eslesen kayitli segment yok</option> : null}
              {segmentOptions.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {form.targetMode === "ad_hoc_segment" ? (
          <>
            <input
              className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
              value={form.adHocDomain}
              onChange={(e) => setForm((s) => ({ ...s, adHocDomain: e.target.value }))}
              placeholder="Ad-hoc alan adi (ornek: gmail.com)"
            />
            <label className="flex items-center gap-2 rounded-md border border-border bg-zinc-900 px-3 py-2 text-xs">
              <input type="checkbox" checked={form.adHocOpened} onChange={(e) => setForm((s) => ({ ...s, adHocOpened: e.target.checked }))} />
              Opened recipients
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-zinc-900 px-3 py-2 text-xs">
              <input type="checkbox" checked={form.adHocClicked} onChange={(e) => setForm((s) => ({ ...s, adHocClicked: e.target.checked }))} />
              Clicked recipients
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-zinc-900 px-3 py-2 text-xs">
              <input type="checkbox" checked={form.adHocFailed} onChange={(e) => setForm((s) => ({ ...s, adHocFailed: e.target.checked }))} />
              Failed deliveries
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-zinc-900 px-3 py-2 text-xs">
              <input type="checkbox" checked={form.adHocSuppressed} onChange={(e) => setForm((s) => ({ ...s, adHocSuppressed: e.target.checked }))} />
              Suppressed recipients
            </label>
          </>
        ) : null}
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">Gonderim Stratejisi</span>
          <select
            className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
            value={form.strategy}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                strategy: e.target.value as "round_robin" | "rotate_every_n" | "weighted_warmup" | "least_used" | "health_based"
              }))
            }
          >
            <option value="rotate_every_n">Her N e-postada donusum</option>
            <option value="round_robin">Sirali dagitim</option>
            <option value="weighted_warmup">Isinma/hiza gore agirlikli</option>
            <option value="least_used">En az kullanilandan basla</option>
            <option value="health_based">Saglik oncelikli</option>
          </select>
          <p className="text-[11px] text-zinc-500">Sirali dagitim, gonderimleri SMTP havuzuna dengeli sekilde yayar.</p>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-zinc-400">SMTP Degisim Araligi</span>
          <input
            className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
            type="number"
            min={1}
            max={50000}
            value={form.rotateEvery}
            onChange={(e) => setForm((s) => ({ ...s, rotateEvery: Number(e.target.value || 500) }))}
            placeholder="Her N e-postada donusum"
          />
          <p className="text-[11px] text-zinc-500">Bu kadar alicidan sonra sistem siradaki SMTP'ye gecer. Varsayilan 500 onerilir.</p>
        </label>
        <p className="rounded-md border border-border bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400 md:col-span-2">
          Kampanya, uygun durumdaki tum aktif SMTP hesaplari uzerinden otomatik dagitilir.
        </p>
      </div>

      {bootstrapError ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          Bootstrap error: {bootstrapError}
        </div>
      ) : null}

      {templateOptions.length === 0 || listOptions.length === 0 || usableSmtpOptions.length === 0 ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-border bg-zinc-900/50 p-3 text-xs text-zinc-300">
          {templateOptions.length === 0 ? <Link className="rounded border border-border px-2 py-1" href="/templates">Sablon olustur</Link> : null}
          {listOptions.length === 0 ? <Link className="rounded border border-border px-2 py-1" href="/lists">Alici listesi olustur</Link> : null}
          {usableSmtpOptions.length === 0 ? <Link className="rounded border border-border px-2 py-1" href="/settings/smtp">Kullanilabilir SMTP hesaplarini ekle/duzelt</Link> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-zinc-900/40 p-3 text-xs text-zinc-300 md:grid-cols-3">
        <p>
          Hedef:{" "}
          {form.targetMode === "list"
            ? selectedList?.name ?? "-"
            : form.targetMode === "saved_segment"
              ? selectedSegment?.name ?? "-"
              : "Ad-hoc segment"}
        </p>
        <p>Tahmini alici sayisi: {estimatedTarget.toLocaleString()}</p>
        <p>Tahmini hiz: {estimatedRate.toFixed(2)}/s</p>
      </div>
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-zinc-900/30 p-3 text-xs text-zinc-300 md:grid-cols-3">
        <p>Gonderim: Tum uygun SMTP havuzu</p>
        <p>Tahmini aktif lane: {usableSmtpOptions.length}</p>
        <p>Bu kampanya paralel SMTP pool modu ile calisir</p>
      </div>
      {targetZero ? (
        <p className="flex items-center gap-1 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          Kampanya baslatilamaz: Secilen hedefte alici bulunmuyor.
        </p>
      ) : null}
      {selectedTemplate?.status === "draft" ? (
        <p className="flex items-center gap-1 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          Taslak sablon secildi. Uretim gonderimi icin aktif sablon onerilir.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
          onClick={createAndStartCampaign}
          disabled={actionLoading !== null || noTemplate || targetEmpty || targetZero || noUsableSmtp}
        >
          {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Olustur ve Baslat
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() => void action("pause")}
          disabled={actionLoading !== null || !campaignId || !canPause}
        >
          <Pause className="h-4 w-4" />
          Pause
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() => void action("resume")}
          disabled={actionLoading !== null || !campaignId || !canResume}
        >
          <Play className="h-4 w-4" />
          Resume
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-red-500 px-3 py-2 text-sm text-red-300 disabled:opacity-60"
          onClick={() => void action("cancel")}
          disabled={actionLoading !== null || !campaignId || !canCancel}
        >
          <StopCircle className="h-4 w-4" />
          Cancel
        </button>
      </div>

      <div className="rounded-md bg-zinc-900 p-3">
        <div className="mb-2 flex justify-between text-xs text-zinc-400">
          <span>Progress</span>
          <span>{live?.progress ?? 0}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-accent transition-all" style={{ width: progressWidth }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Metric label="Gonderildi" value={live?.sent ?? 0} />
        <Metric label="Basarisiz" value={live?.failed ?? 0} />
        <Metric label="Atlandi" value={live?.skipped ?? 0} />
        <Metric label="Efektif Hiz" value={`${live?.effectiveRate ?? 0}/s`} />
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <Metric label="Kuyruk Bekleyen" value={live?.queue?.waiting ?? 0} />
        <Metric label="Kuyruk Aktif" value={live?.queue?.active ?? 0} />
        <Metric label="Kuyruk Basarisiz" value={live?.queue?.failed ?? 0} />
      </div>
      {live && (live.targetTotalRps ?? 0) > 0 && (live.effectiveRate ?? 0) < (live.targetTotalRps ?? 0) * 0.8 ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Hedef hızın altında gönderim yapılıyor. Sebep: {live.bottleneckReason ?? "none"}
          {live.bottleneckReason === "warmup_cap" ? " · Warmup sınırı nedeniyle hedef hız düşüyor. Hedefi uygula butonuyla uygun SMTP’lerin warmup limitleri yükseltilebilir." : ""}
        </p>
      ) : null}

      {live ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <StatusBadge label={live.status} tone={live.status === "running" ? "success" : "info"} />
            {live.throttleReason ? <StatusBadge label={live.throttleReason} tone="warning" /> : null}
            {live.warmupTier ? <StatusBadge label={`tier ${live.warmupTier}`} tone="muted" /> : null}
            {live.currentRotation ? <StatusBadge label={`rotation: ${live.currentRotation}`} tone="info" /> : null}
          </div>
          {live.activeSmtps && live.activeSmtps.length > 0 ? (
            <div className="rounded border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
              {live.activeSmtps.length} SMTP aktif
              <button
                type="button"
                onClick={() => setShowActiveSmtps((prev) => !prev)}
                className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] text-zinc-200"
              >
                Aktif SMTP’leri göster
              </button>
              {showActiveSmtps ? (
                <p className="mt-1 text-[11px] text-zinc-400">{live.activeSmtps.map((smtp) => smtp.name).join(", ")}</p>
              ) : null}
            </div>
          ) : null}
          {live.perSmtpSent && live.perSmtpSent.length > 0 ? (
            <div className="rounded border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
              <p className="mb-1 uppercase tracking-wide text-zinc-400">SMTP Bazli Gonderim</p>
              <div className="grid gap-1 md:grid-cols-2">
                {live.perSmtpSent.map((item) => (
                  <p key={item.smtpAccountId} className="rounded bg-zinc-900/80 px-2 py-1">
                    {item.smtpName}: {item.sent}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
            Hedef toplam RPS: {Number(live.targetTotalRps ?? 0).toFixed(2)} · Gerçek RPS: {Number(live.effectiveRate ?? 0).toFixed(2)} ·
            Aktif lane: {live.activeLaneCount ?? 0} · Uygun SMTP: {live.eligibleSmtpCount ?? 0} · SMTP başı hedef RPS: {Number(live.targetPerSmtpRps ?? 0).toFixed(2)} ·
            SMTP başı efektif ortalama RPS: {Number(live.avgPerSmtpRps ?? 0).toFixed(2)} · Warmup cap toplamı: {Number(live.warmupCapTotalRps ?? 0).toFixed(2)} ·
            Throttle cap toplamı: {Number(live.throttleCapTotalRps ?? 0).toFixed(2)} · Provider cap toplamı: {Number(live.providerCapTotalRps ?? 0).toFixed(2)} ·
            Bottleneck: {live.bottleneckReason ?? "none"}
          </div>
          <div className="rounded border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
            DB pending: {live.dbPendingRecipients ?? 0} · DB processing: {live.dbProcessingRecipients ?? 0} · DB sent: {live.dbSentRecipients ?? 0} ·
            DB failed: {live.dbFailedRecipients ?? 0} · DB skipped: {live.dbSkippedRecipients ?? 0} · Redis waiting jobs: {live.redisWaitingJobs ?? 0} · Redis active jobs: {live.redisActiveJobs ?? 0} ·
            Scheduler batch size: {live.schedulerBatchSize ?? 0} · Last scheduler enqueued: {live.lastSchedulerEnqueued ?? 0} · Reason: {live.lastSchedulerReason ?? "unknown"}
          </div>
          {live.bottleneckReason === "warmup_cap" ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
              Warmup cap nedeniyle sınırlanan SMTP: {live.warmupBottleneckSmtpCount ?? 0} · Ortalama warmup cap: {Number(live.warmupAvgCapRps ?? 0).toFixed(2)} RPS ·
              Hedef uygulanırsa beklenen RPS: {Number(live.expectedRpsAfterApply ?? 0).toFixed(2)}
            </div>
          ) : null}
          <div className="rounded border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
            Global günlük hedef: {Number(live.dailyTarget ?? 0).toLocaleString()}/gün
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-zinc-900/40 p-3">
        <p className="text-xs uppercase tracking-wider text-zinc-400">Canli Kayitlar</p>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          {logs.length === 0 ? <p className="text-zinc-500">Henuz canli olay yok. Kayit akisi icin kampanya baslatin.</p> : null}
          {logs.map((line) => (
            <p key={line} className="rounded bg-zinc-900/80 px-2 py-1">
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-zinc-900/50 p-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
