"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [form, setForm] = useState({
    name: "Nexus Test Campaign",
    templateId: "",
    listId: "",
    smtpAccountId: ""
  });

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/send/bootstrap");
      if (!response.ok) return;
      const data = (await response.json()) as BootstrapData;
      setBootstrap(data);
      setForm((prev) => ({
        ...prev,
        templateId: data.templates[0]?.id ?? "",
        listId: data.lists[0]?.id ?? "",
        smtpAccountId: data.smtps[0]?.id ?? ""
      }));
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

  async function createAndStartCampaign() {
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
    if (!createRes.ok) return;
    const created = (await createRes.json()) as { campaign: { id: string } };
    await fetch(`/api/campaigns/${created.campaign.id}/start`, { method: "POST" });
    setCampaignId(created.campaign.id);
    setLogs((prev) => [`campaign created + started: ${created.campaign.id}`, ...prev]);
  }

  async function action(kind: "pause" | "resume" | "cancel") {
    if (!campaignId) return;
    await fetch(`/api/campaigns/${campaignId}/${kind}`, { method: "POST" });
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
        <button className="rounded bg-accent px-3 py-2 text-sm text-white" onClick={createAndStartCampaign}>
          Create + Start
        </button>
        <button className="rounded border border-border px-3 py-2 text-sm" onClick={() => void action("pause")}>
          Pause
        </button>
        <button className="rounded border border-border px-3 py-2 text-sm" onClick={() => void action("resume")}>
          Resume
        </button>
        <button className="rounded border border-red-500 px-3 py-2 text-sm text-red-300" onClick={() => void action("cancel")}>
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

      <div className="rounded-md border border-border bg-zinc-900/40 p-3">
        <p className="text-xs uppercase tracking-wider text-zinc-400">Live Logs</p>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          {logs.map((line) => (
            <p key={line}>{line}</p>
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
