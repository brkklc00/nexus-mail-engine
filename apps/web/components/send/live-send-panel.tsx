"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pause, Play, Rocket, StopCircle } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
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
  smtps: Array<{
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
    sendingMode?: "single" | "pool";
    useAllActiveByDefault?: boolean;
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
};

export function LiveSendPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const { t } = useI18n();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [live, setLive] = useState<LiveEvent | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
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
    smtpAccountId: "",
    smtpMode: "single" as "single" | "pool",
    smtpIds: [] as string[],
    parallelSmtpCount: 1,
    rotateEvery: 500,
    strategy: "round_robin" as "round_robin" | "rotate_every_n" | "weighted_warmup" | "least_used" | "health_based"
  });

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/send/bootstrap");
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
        const smtpAccounts = data.smtpAccounts ?? data.smtps ?? [];
        const safeTemplates = Array.isArray(data.templates) ? data.templates : [];
        const safeLists = Array.isArray(data.lists) ? data.lists : [];
        const safeSegments = Array.isArray(data.segments) ? data.segments : [];
        const safeSmtps = Array.isArray(smtpAccounts) ? smtpAccounts : [];

        const firstTemplate = safeTemplates.find((item) => item.status === "active")?.id ?? safeTemplates[0]?.id ?? "";
        const firstList = safeLists.find((item) => item.estimatedRecipients > 0)?.id ?? safeLists[0]?.id ?? "";
        const firstSegment = safeSegments[0]?.id ?? "";
        const activeSmtpPool = safeSmtps
          .filter((smtp) => smtp.isActive !== false)
          .map((smtp) => smtp.id);

        setBootstrap(data);
        setBootstrapError(null);
        setForm((prev) => ({
          ...prev,
          targetMode: data.defaults?.targetType ?? "list",
          templateId: firstTemplate,
          listId: firstList,
          segmentId: firstSegment,
          smtpAccountId: activeSmtpPool[0] ?? safeSmtps[0]?.id ?? "",
          smtpIds: activeSmtpPool.length > 0 ? activeSmtpPool : safeSmtps[0]?.id ? [safeSmtps[0].id] : [],
          rotateEvery: Number(data.defaults?.rotateEvery ?? data.poolSettings?.rotateEvery ?? 500),
          parallelSmtpCount: Number(data.defaults?.parallelSmtpCount ?? data.poolSettings?.parallelSmtpLanes ?? 1),
          smtpMode: data.defaults?.smtpMode ?? data.poolSettings?.sendingMode ?? "pool",
          strategy: data.defaults?.strategy ?? "round_robin"
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Request failed";
        setBootstrapError(message);
        toast.error(t("send.bootstrapFailedTitle"), message || t("send.bootstrapFailedBody"));
      } finally {
        setLoadingBootstrap(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    const source = new EventSource(`/send/stream?campaignId=${campaignId}`);
    source.addEventListener("progress", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data) as LiveEvent;
      setLive(payload);
      setLogs((prev) => [
        `status=${payload.status} sent=${payload.sent} failed=${payload.failed} rate=${payload.effectiveRate}/s`,
        ...prev
      ].slice(0, 12));
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
  const smtpOptions = bootstrap?.smtpAccounts ?? bootstrap?.smtps ?? [];
  const activeSmtpOptions = smtpOptions.filter((smtp) => smtp.isActive !== false);
  const selectedList = bootstrap?.lists.find((list) => list.id === form.listId) ?? null;
  const selectedSegment = bootstrap?.segments.find((segment) => segment.id === form.segmentId) ?? null;
  const selectedTemplate = templateOptions.find((item) => item.id === form.templateId) ?? null;
  const selectedPool = activeSmtpOptions.filter((smtp) =>
    form.smtpMode === "single" ? smtp.id === form.smtpAccountId : form.smtpIds.includes(smtp.id)
  );
  const estimatedRate = selectedPool.reduce((sum, smtp) => sum + (smtp.maxRatePerSecond ?? smtp.targetRatePerSecond ?? 0), 0);
  const poolEmpty = form.smtpMode === "pool" ? selectedPool.length === 0 : !form.smtpAccountId;
  const targetEmpty =
    form.targetMode === "list"
      ? !form.listId
      : form.targetMode === "saved_segment"
        ? !form.segmentId
        : !form.adHocDomain && !form.adHocOpened && !form.adHocClicked && !form.adHocFailed && !form.adHocSuppressed;
  const estimatedTarget =
    form.targetMode === "list" ? selectedList?.estimatedRecipients ?? 0 : selectedSegment?.lastMatchedCount ?? 0;
  const selectedSmtpCount = selectedPool.length;
  const targetZero =
    form.targetMode === "list"
      ? Boolean(form.listId) && estimatedTarget <= 0
      : form.targetMode === "saved_segment"
        ? Boolean(form.segmentId) && estimatedTarget <= 0
        : false;
  const noTemplate = !form.templateId;
  const noUsableSmtp = activeSmtpOptions.length === 0 || selectedSmtpCount === 0;

  function toggleSmtpInPool(smtpId: string) {
    setForm((prev) => {
      const exists = prev.smtpIds.includes(smtpId);
      const smtpIds = exists ? prev.smtpIds.filter((id) => id !== smtpId) : [...prev.smtpIds, smtpId];
      return {
        ...prev,
        smtpIds,
        smtpAccountId: smtpIds[0] ?? prev.smtpAccountId
      };
    });
  }

  async function createAndStartCampaign() {
    if (noTemplate) {
      toast.warning(t("send.templateRequiredTitle"), t("send.templateRequiredBody"));
      return;
    }
    if (targetEmpty) {
      toast.warning(t("send.targetRequiredTitle"), t("send.targetRequiredBody"));
      return;
    }
    if (targetZero) {
      toast.warning(t("send.targetZeroTitle"), t("send.targetZeroBody"));
      return;
    }
    if (noUsableSmtp) {
      toast.warning(t("send.smtpRequiredTitle"), t("send.smtpRequiredBody"));
      return;
    }
    const selectedSmtpNames = selectedPool.map((smtp) => smtp.name).join(", ");
    const confirmed = await confirm({
      title: "Start this campaign?",
      message: `Target: ${estimatedTarget} recipient | SMTP: ${selectedSmtpNames || "-"} | Rotation: ${form.strategy} / every ${form.rotateEvery} | Estimated throughput: ${estimatedRate.toFixed(2)}/s`,
      confirmLabel: "Create + Start",
      cancelLabel: t("common.cancel"),
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
          smtpAccountId: form.smtpMode === "single" ? form.smtpAccountId : form.smtpIds[0],
          smtpMode: form.smtpMode,
          smtpIds: form.smtpMode === "single" ? [form.smtpAccountId] : form.smtpIds,
          parallelSmtpCount: form.parallelSmtpCount,
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
      toast.success("Campaign started");
    } catch (error) {
      toast.error("Campaign could not be started", error instanceof Error ? error.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function action(kind: "pause" | "resume" | "cancel") {
    if (!campaignId) return;
    if (kind === "cancel") {
      const accepted = await confirm({
        title: "Cancel this campaign?",
        message: "Pending sends will be marked as skipped.",
        confirmLabel: "Cancel campaign",
        cancelLabel: t("common.cancel"),
        tone: "danger"
      });
      if (!accepted) return;
    }
    setActionLoading(kind);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${kind}`, { method: "POST" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `${kind} failed`);
      }
      toast.info(`Campaign ${kind} request accepted`);
    } catch (error) {
      toast.error(`Campaign ${kind} failed`, error instanceof Error ? error.message : `${kind} failed`);
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
        <input
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          placeholder="Campaign name"
        />
        <select
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.templateId}
          onChange={(e) => setForm((s) => ({ ...s, templateId: e.target.value }))}
          disabled={templateOptions.length === 0}
        >
          {templateOptions.length === 0 ? <option value="">No active templates</option> : null}
          {templateOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}{t.status === "draft" ? " (draft)" : ""}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.targetMode}
          onChange={(e) => setForm((s) => ({ ...s, targetMode: e.target.value as "list" | "saved_segment" | "ad_hoc_segment" }))}
        >
          <option value="list">Target: Recipient list</option>
          <option value="saved_segment">Target: Saved segment</option>
          <option value="ad_hoc_segment">Target: Ad-hoc segment query</option>
        </select>
        {form.targetMode === "list" ? (
          <select
            className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
            value={form.listId}
            onChange={(e) => setForm((s) => ({ ...s, listId: e.target.value }))}
            disabled={listOptions.length === 0}
          >
            {listOptions.length === 0 ? <option value="">No usable recipient lists</option> : null}
            {listOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        ) : null}
        {form.targetMode === "saved_segment" ? (
          <select
            className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
            value={form.segmentId}
            onChange={(e) => setForm((s) => ({ ...s, segmentId: e.target.value }))}
            disabled={segmentOptions.length === 0}
          >
            {segmentOptions.length === 0 ? <option value="">No matched saved segments</option> : null}
            {segmentOptions.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </select>
        ) : null}
        {form.targetMode === "ad_hoc_segment" ? (
          <>
            <input
              className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
              value={form.adHocDomain}
              onChange={(e) => setForm((s) => ({ ...s, adHocDomain: e.target.value }))}
              placeholder="Ad-hoc domain (example: gmail.com)"
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
        <select
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.smtpAccountId}
          onChange={(e) => setForm((s) => ({ ...s, smtpAccountId: e.target.value }))}
          disabled={activeSmtpOptions.length === 0}
        >
          {activeSmtpOptions.length === 0 ? <option value="">No active SMTP accounts</option> : null}
          {activeSmtpOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.warning ? ` (${s.warning})` : ""}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.smtpMode}
          onChange={(e) => setForm((s) => ({ ...s, smtpMode: e.target.value as "single" | "pool" }))}
        >
          <option value="single">SMTP mode: Single SMTP</option>
          <option value="pool">SMTP mode: SMTP pool</option>
        </select>
        <select
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.strategy}
          onChange={(e) =>
            setForm((s) => ({
              ...s,
              strategy: e.target.value as "round_robin" | "rotate_every_n" | "weighted_warmup" | "least_used" | "health_based"
            }))
          }
        >
          <option value="rotate_every_n">Strategy: rotate every N emails</option>
          <option value="round_robin">Strategy: round robin</option>
          <option value="weighted_warmup">Strategy: weighted by warmup/rate</option>
          <option value="least_used">Strategy: least used SMTP first</option>
          <option value="health_based">Strategy: health-based priority</option>
        </select>
        <input
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          type="number"
          min={1}
          max={50}
          value={form.parallelSmtpCount}
          onChange={(e) => setForm((s) => ({ ...s, parallelSmtpCount: Number(e.target.value || 1) }))}
          placeholder="Parallel SMTP count"
        />
        <input
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          type="number"
          min={1}
          max={50000}
          value={form.rotateEvery}
          onChange={(e) => setForm((s) => ({ ...s, rotateEvery: Number(e.target.value || 500) }))}
          placeholder="Rotate every N emails"
        />
      </div>

      {bootstrapError ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          Bootstrap error: {bootstrapError}
        </div>
      ) : null}

      {templateOptions.length === 0 || listOptions.length === 0 || activeSmtpOptions.length === 0 ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-border bg-zinc-900/50 p-3 text-xs text-zinc-300">
          {templateOptions.length === 0 ? <Link className="rounded border border-border px-2 py-1" href="/templates">Create template</Link> : null}
          {listOptions.length === 0 ? <Link className="rounded border border-border px-2 py-1" href="/lists">Create recipient list</Link> : null}
          {activeSmtpOptions.length === 0 ? <Link className="rounded border border-border px-2 py-1" href="/settings/smtp">Add SMTP account</Link> : null}
        </div>
      ) : null}

      {form.smtpMode === "pool" ? (
        <div className="space-y-2 rounded-md border border-border bg-zinc-900/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wider text-zinc-400">SMTP Pool Selector</p>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs text-zinc-300"
              onClick={() => setForm((s) => ({ ...s, smtpIds: activeSmtpOptions.map((smtp) => smtp.id) }))}
            >
              Select all active SMTPs
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {activeSmtpOptions.map((smtp) => {
              const checked = form.smtpIds.includes(smtp.id);
              return (
                <label
                  key={smtp.id}
                  className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${
                    checked ? "border-indigo-500 bg-indigo-500/10 text-indigo-200" : "border-border bg-zinc-900/60 text-zinc-300"
                  }`}
                >
                  <span>
                    {smtp.name} · {smtp.maxRatePerSecond ?? smtp.targetRatePerSecond}/s
                  </span>
                  <input type="checkbox" checked={checked} onChange={() => toggleSmtpInPool(smtp.id)} />
                </label>
              );
            })}
          </div>
          {poolEmpty ? (
            <p className="flex items-center gap-1 text-xs text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              SMTP pool is empty. Campaign cannot be started.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-zinc-900/40 p-3 text-xs text-zinc-300 md:grid-cols-3">
        <p>
          Target:{" "}
          {form.targetMode === "list"
            ? selectedList?.name ?? "-"
            : form.targetMode === "saved_segment"
              ? selectedSegment?.name ?? "-"
              : "Ad-hoc segment"}
        </p>
        <p>Estimated target count: {estimatedTarget}</p>
        <p>Estimated throughput: {estimatedRate.toFixed(2)}/s</p>
      </div>
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-zinc-900/30 p-3 text-xs text-zinc-300 md:grid-cols-3">
        <p>Selected SMTP count: {selectedSmtpCount}</p>
        <p>Strategy: {form.strategy} · rotateEvery: {form.rotateEvery}</p>
        <p>Parallel SMTP count: {form.parallelSmtpCount}</p>
      </div>
      {targetZero ? (
        <p className="flex items-center gap-1 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          Campaign cannot start because selected target has 0 recipients.
        </p>
      ) : null}
      {selectedTemplate?.status === "draft" ? (
        <p className="flex items-center gap-1 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          A draft template is selected. Use an active template for production sends.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
          onClick={createAndStartCampaign}
          disabled={actionLoading !== null || noTemplate || poolEmpty || targetEmpty || targetZero || noUsableSmtp}
        >
          {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Create + Start
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
        <Metric label="Sent" value={live?.sent ?? 0} />
        <Metric label="Failed" value={live?.failed ?? 0} />
        <Metric label="Skipped" value={live?.skipped ?? 0} />
        <Metric label="Effective Rate" value={`${live?.effectiveRate ?? 0}/s`} />
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <Metric label="Queue Waiting" value={live?.queue?.waiting ?? 0} />
        <Metric label="Queue Active" value={live?.queue?.active ?? 0} />
        <Metric label="Queue Failed" value={live?.queue?.failed ?? 0} />
      </div>

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
              Active SMTPs: {live.activeSmtps.map((smtp) => smtp.name).join(", ")}
            </div>
          ) : null}
          {live.perSmtpSent && live.perSmtpSent.length > 0 ? (
            <div className="rounded border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
              <p className="mb-1 uppercase tracking-wide text-zinc-400">Per SMTP Sent</p>
              <div className="grid gap-1 md:grid-cols-2">
                {live.perSmtpSent.map((item) => (
                  <p key={item.smtpAccountId} className="rounded bg-zinc-900/80 px-2 py-1">
                    {item.smtpName}: {item.sent}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-zinc-900/40 p-3">
        <p className="text-xs uppercase tracking-wider text-zinc-400">Live Logs</p>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          {logs.length === 0 ? <p className="text-zinc-500">No live events yet. Start a campaign to stream logs.</p> : null}
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
