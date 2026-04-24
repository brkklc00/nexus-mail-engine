"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Loader2, Pause, Play, Rocket, StopCircle } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

type BootstrapData = {
  templates: Array<{ id: string; title: string }>;
  lists: Array<{ id: string; name: string }>;
  smtps: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string; status: string }>;
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
};

export function LiveSendPanel() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [live, setLive] = useState<LiveEvent | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);
  const [actionLoading, setActionLoading] = useState<null | "create" | "pause" | "resume" | "cancel">(null);
  const [form, setForm] = useState({
    name: "Nexus Test Campaign",
    templateId: "",
    listId: "",
    smtpAccountId: ""
  });

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/send/bootstrap");
        if (!response.ok) {
          throw new Error("Bootstrap verisi alinamadi");
        }
        const data = (await response.json()) as BootstrapData;
        setBootstrap(data);
        setForm((prev) => ({
          ...prev,
          templateId: data.templates[0]?.id ?? "",
          listId: data.lists[0]?.id ?? "",
          smtpAccountId: data.smtps[0]?.id ?? ""
        }));
      } catch (error) {
        setToast({ kind: "error", text: error instanceof Error ? error.message : "Bootstrap request failed" });
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

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const progressWidth = useMemo(() => `${Math.min(100, Math.max(0, live?.progress ?? 0))}%`, [live]);

  async function createAndStartCampaign() {
    setActionLoading("create");
    try {
      const createRes = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          templateId: form.templateId,
          listId: form.listId,
          smtpAccountId: form.smtpAccountId
        })
      });
      if (!createRes.ok) {
        const err = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Campaign create failed");
      }
      const created = (await createRes.json()) as { campaign: { id: string } };
      const startRes = await fetch(`/api/campaigns/${created.campaign.id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const err = (await startRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Campaign start failed");
      }
      setCampaignId(created.campaign.id);
      setLogs((prev) => [`campaign created + started: ${created.campaign.id}`, ...prev]);
      setToast({ kind: "ok", text: "Campaign started successfully" });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "Campaign action failed" });
    } finally {
      setActionLoading(null);
    }
  }

  async function action(kind: "pause" | "resume" | "cancel") {
    if (!campaignId) return;
    setActionLoading(kind);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${kind}`, { method: "POST" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `${kind} failed`);
      }
      setToast({ kind: "ok", text: `Campaign ${kind} request accepted` });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : `${kind} failed` });
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
      {toast ? (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
            toast.kind === "ok"
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : "border-rose-400/40 bg-rose-500/10 text-rose-300"
          }`}
        >
          {toast.kind === "ok" ? <CircleCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
          {toast.text}
        </div>
      ) : null}

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
        >
          {(bootstrap?.templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.listId}
          onChange={(e) => setForm((s) => ({ ...s, listId: e.target.value }))}
        >
          {(bootstrap?.lists ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm"
          value={form.smtpAccountId}
          onChange={(e) => setForm((s) => ({ ...s, smtpAccountId: e.target.value }))}
        >
          {(bootstrap?.smtps ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
          onClick={createAndStartCampaign}
          disabled={actionLoading !== null || !form.templateId || !form.listId || !form.smtpAccountId}
        >
          {actionLoading === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Create + Start
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() => void action("pause")}
          disabled={actionLoading !== null || !campaignId}
        >
          <Pause className="h-4 w-4" />
          Pause
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() => void action("resume")}
          disabled={actionLoading !== null || !campaignId}
        >
          <Play className="h-4 w-4" />
          Resume
        </button>
        <button
          className="inline-flex items-center gap-1 rounded border border-red-500 px-3 py-2 text-sm text-red-300 disabled:opacity-60"
          onClick={() => void action("cancel")}
          disabled={actionLoading !== null || !campaignId}
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

      {live ? (
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={live.status} tone={live.status === "running" ? "success" : "info"} />
          {live.throttleReason ? <StatusBadge label={live.throttleReason} tone="warning" /> : null}
          {live.warmupTier ? <StatusBadge label={`tier ${live.warmupTier}`} tone="muted" /> : null}
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
