"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

type BootstrapData = {
  templates: Array<{ id: string; title: string }>;
  lists: Array<{ id: string; name: string; estimatedRecipients: number }>;
  smtps: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string; status: string }>;
  segments: Array<{ id: string; name: string; lastMatchedCount: number; updatedAt: string }>;
};

type SegmentQuery = {
  baseListId?: string | null;
  campaignId?: string | null;
  templateId?: string | null;
  listId?: string | null;
  smtpAccountId?: string | null;
  from?: string | null;
  to?: string | null;
  engagement?: {
    opened?: boolean;
    notOpened?: boolean;
    clicked?: boolean;
    notClicked?: boolean;
    unsubscribed?: boolean;
  };
  delivery?: Array<"sent" | "failed" | "skipped" | "suppressed">;
  emailDomain?: string | null;
  suppressionMode?: "all" | "include" | "exclude";
  previousCampaignMode?: "all" | "include" | "exclude";
};

type SegmentListItem = {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  rulesSummary: SegmentQuery;
  matchedCount: number;
  lastCalculatedAt: string;
  campaignsUsing: number;
};

type QueryResponse = {
  ok: boolean;
  stats: {
    matchedRecipients: number;
    openedCount: number;
    notOpenedCount: number;
    clickedCount: number;
    notClickedCount: number;
    failedCount: number;
    suppressedCount: number;
    unsubscribeCount: number;
    topDomains: Array<{ domain: string; count: number }>;
    topClickedLinks: Array<{ url: string; clicks: number }>;
  };
  sample: Array<{ id: string; email: string; status: string; domain: string }>;
};

const defaultQuery: SegmentQuery = {
  suppressionMode: "all",
  previousCampaignMode: "all",
  engagement: {},
  delivery: []
};

function toggleDelivery(current: SegmentQuery, value: "sent" | "failed" | "skipped" | "suppressed"): SegmentQuery {
  const set = new Set(current.delivery ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return { ...current, delivery: Array.from(set) as SegmentQuery["delivery"] };
}

export function SegmentsManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [segments, setSegments] = useState<SegmentListItem[]>([]);
  const [query, setQuery] = useState<SegmentQuery>(defaultQuery);
  const [search, setSearch] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const initialLoadErrorShown = useRef(false);

  const hasTrackingData = useMemo(() => Boolean(queryResult?.stats.topClickedLinks.length || queryResult?.stats.openedCount), [queryResult]);

  async function loadBootstrap() {
    const response = await fetch("/api/send/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error("Bootstrap could not be loaded");
    const payload = (await response.json()) as BootstrapData;
    setBootstrap(payload);
  }

  function showInitialLoadErrorOnce(title: string, description: string) {
    if (initialLoadErrorShown.current) return;
    initialLoadErrorShown.current = true;
    toast.error(title, description);
  }

  async function loadSegments(options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent);
    setLoadingSegments(true);
    try {
      const response = await fetch("/api/segments?page=1&pageSize=50", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; items?: SegmentListItem[]; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Segment list could not be loaded");
      }
      setSegments(payload.items ?? []);
    } catch (error) {
      setSegments([]);
      if (!silent) {
        toast.error("Segment list could not be loaded", error instanceof Error ? error.message : "Unexpected error");
      } else {
        showInitialLoadErrorOnce("Segment list could not be loaded", error instanceof Error ? error.message : "Unexpected error");
      }
    } finally {
      setLoadingSegments(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadBootstrap(), loadSegments({ silent: true })]);
      } catch (error) {
        showInitialLoadErrorOnce("Segment bootstrap could not be loaded", error instanceof Error ? error.message : "Request failed");
        setSegments([]);
      }
    })();
  }, []);

  async function runQuery() {
    setLoading(true);
    try {
      const response = await fetch("/api/segments/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, page: 1, pageSize: 50, search })
      });
      const payload = (await response.json().catch(() => ({}))) as QueryResponse & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Segment query failed");
      }
      setQueryResult(payload);
    } catch (error) {
      toast.error("Segment query failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv(mode: "matched" | "clicked" | "not_clicked" | "opened" | "not_opened" | "failed" | "suppressed") {
    try {
      const response = await fetch("/api/segments/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode, search, fileName: `segment-${mode}.csv` })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Export failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `segment-${mode}.csv`;
      anchor.click();
      window.URL.revokeObjectURL(url);
      toast.success("CSV export prepared");
    } catch (error) {
      toast.error("CSV export failed", error instanceof Error ? error.message : "Unexpected error");
    }
  }

  async function saveSegment() {
    if (!saveName.trim()) {
      toast.warning("Segment name is required");
      return;
    }
    try {
      const response = await fetch("/api/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDescription.trim() || undefined,
          listId: query.baseListId || undefined,
          queryConfig: query
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Segment could not be saved");
      }
      toast.success("Segment saved");
      setSaveName("");
      setSaveDescription("");
      await loadSegments();
    } catch (error) {
      toast.error("Segment could not be saved", error instanceof Error ? error.message : "Unexpected error");
    }
  }

  async function mutateSegment(id: string, payload: any, successTitle: string) {
    const response = await fetch(`/api/segments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? "Operation failed");
    }
    toast.success(successTitle);
    await loadSegments();
  }

  async function deleteSegment(id: string) {
    const approved = await confirm({
      title: "Delete segment?",
      message: "It will be permanently deleted if it is not used by any campaign.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "danger"
    });
    if (!approved) return;
    try {
      const response = await fetch(`/api/segments/${id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Delete failed");
      }
      toast.success("Segment deleted");
      await loadSegments();
    } catch (error) {
      toast.error("Segment could not be deleted", error instanceof Error ? error.message : "Unexpected error");
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-white">Segments are dynamic audiences built from delivery and engagement behavior.</p>
        <p className="mt-1 text-xs text-zinc-400">
          Recipients are not listed by default. Running a query shows at most 50 sample rows.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">Segment Builder</p>
          <button type="button" onClick={() => void runQuery()} className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200">
            {loading ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="inline h-3.5 w-3.5" />} Run Query
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <select
            value={query.baseListId ?? ""}
            onChange={(e) => setQuery((s) => ({ ...s, baseListId: e.target.value || null }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">Base list: all recipients</option>
            {(bootstrap?.lists ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={query.campaignId ?? ""}
            onChange={(e) => setQuery((s) => ({ ...s, campaignId: e.target.value || null }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">Campaign: all</option>
            {(bootstrap?.campaigns ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={query.templateId ?? ""}
            onChange={(e) => setQuery((s) => ({ ...s, templateId: e.target.value || null }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">Template: all</option>
            {(bootstrap?.templates ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <select
            value={query.smtpAccountId ?? ""}
            onChange={(e) => setQuery((s) => ({ ...s, smtpAccountId: e.target.value || null }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">SMTP: all</option>
            {(bootstrap?.smtps ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={query.from ?? ""}
            onChange={(e) => setQuery((s) => ({ ...s, from: e.target.value || null }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
          <input
            type="datetime-local"
            value={query.to ?? ""}
            onChange={(e) => setQuery((s) => ({ ...s, to: e.target.value || null }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
          <input
            value={query.emailDomain ?? ""}
            onChange={(e) => setQuery((s) => ({ ...s, emailDomain: e.target.value || null }))}
            placeholder="Email domain (gmail.com)"
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search matched recipients"
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
          <select
            value={query.suppressionMode ?? "all"}
            onChange={(e) => setQuery((s) => ({ ...s, suppressionMode: e.target.value as "all" | "include" | "exclude" }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="all">Suppression: all</option>
            <option value="include">Suppression: only suppressed</option>
            <option value="exclude">Suppression: exclude suppressed</option>
          </select>
          <select
            value={query.previousCampaignMode ?? "all"}
            onChange={(e) => setQuery((s) => ({ ...s, previousCampaignMode: e.target.value as "all" | "include" | "exclude" }))}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="all">Previous campaign recipients: all</option>
            <option value="include">Include previous campaign recipients</option>
            <option value="exclude">Exclude previous campaign recipients</option>
          </select>
          <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1 xl:col-span-2">
            <Toggle
              label="Opened"
              checked={Boolean(query.engagement?.opened)}
              onChange={(checked) => setQuery((s) => ({ ...s, engagement: { ...(s.engagement ?? {}), opened: checked } }))}
            />
            <Toggle
              label="Not Opened"
              checked={Boolean(query.engagement?.notOpened)}
              onChange={(checked) => setQuery((s) => ({ ...s, engagement: { ...(s.engagement ?? {}), notOpened: checked } }))}
            />
            <Toggle
              label="Clicked"
              checked={Boolean(query.engagement?.clicked)}
              onChange={(checked) => setQuery((s) => ({ ...s, engagement: { ...(s.engagement ?? {}), clicked: checked } }))}
            />
            <Toggle
              label="Not Clicked"
              checked={Boolean(query.engagement?.notClicked)}
              onChange={(checked) => setQuery((s) => ({ ...s, engagement: { ...(s.engagement ?? {}), notClicked: checked } }))}
            />
            <Toggle
              label="Unsubscribed"
              checked={Boolean(query.engagement?.unsubscribed)}
              onChange={(checked) => setQuery((s) => ({ ...s, engagement: { ...(s.engagement ?? {}), unsubscribed: checked } }))}
            />
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1 xl:col-span-2">
            <Toggle
              label="Sent"
              checked={Boolean(query.delivery?.includes("sent"))}
              onChange={() => setQuery((s) => toggleDelivery(s, "sent"))}
            />
            <Toggle
              label="Failed"
              checked={Boolean(query.delivery?.includes("failed"))}
              onChange={() => setQuery((s) => toggleDelivery(s, "failed"))}
            />
            <Toggle
              label="Skipped"
              checked={Boolean(query.delivery?.includes("skipped"))}
              onChange={() => setQuery((s) => toggleDelivery(s, "skipped"))}
            />
            <Toggle
              label="Suppressed"
              checked={Boolean(query.delivery?.includes("suppressed"))}
              onChange={() => setQuery((s) => toggleDelivery(s, "suppressed"))}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Matched" value={queryResult?.stats.matchedRecipients ?? 0} />
          <Stat label="Opened" value={queryResult?.stats.openedCount ?? 0} />
          <Stat label="Not Opened" value={queryResult?.stats.notOpenedCount ?? 0} />
          <Stat label="Clicked" value={queryResult?.stats.clickedCount ?? 0} />
          <Stat label="Not Clicked" value={queryResult?.stats.notClickedCount ?? 0} />
          <Stat label="Failed" value={queryResult?.stats.failedCount ?? 0} />
          <Stat label="Suppressed" value={queryResult?.stats.suppressedCount ?? 0} />
          <Stat label="Unsubscribed" value={queryResult?.stats.unsubscribeCount ?? 0} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-zinc-900/40 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Top Domains</p>
            <div className="mt-2 space-y-1 text-xs text-zinc-300">
              {(queryResult?.stats.topDomains ?? []).map((item) => (
                <p key={item.domain}>
                  {item.domain} - {item.count}
                </p>
              ))}
              {(queryResult?.stats.topDomains ?? []).length === 0 ? <p className="text-zinc-500">No domain data.</p> : null}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-zinc-900/40 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Top Clicked Links</p>
            <div className="mt-2 space-y-1 text-xs text-zinc-300">
              {(queryResult?.stats.topClickedLinks ?? []).map((item) => (
                <p key={item.url} className="truncate">
                  {item.clicks} - {item.url}
                </p>
              ))}
              {(queryResult?.stats.topClickedLinks ?? []).length === 0 ? <p className="text-zinc-500">No click tracking data.</p> : null}
            </div>
          </div>
        </div>
        {!hasTrackingData ? (
          <p className="mt-2 text-xs text-amber-300">Tracking data may not be available yet. Open/click metrics can be empty.</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-white">Export</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ExportButton label="Export matched recipients CSV" onClick={() => void exportCsv("matched")} />
          <ExportButton label="Export clicked recipients" onClick={() => void exportCsv("clicked")} />
          <ExportButton label="Export not clicked recipients" onClick={() => void exportCsv("not_clicked")} />
          <ExportButton label="Export opened recipients" onClick={() => void exportCsv("opened")} />
          <ExportButton label="Export not opened recipients" onClick={() => void exportCsv("not_opened")} />
          <ExportButton label="Export failed recipients" onClick={() => void exportCsv("failed")} />
          <ExportButton label="Export suppressed recipients" onClick={() => void exportCsv("suppressed")} />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-white">Save Segment</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Segment name"
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
          <input
            value={saveDescription}
            onChange={(e) => setSaveDescription(e.target.value)}
            placeholder="Description"
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </div>
        <button type="button" className="mt-3 rounded-lg border border-border px-3 py-2 text-sm text-zinc-100" onClick={() => void saveSegment()}>
          <Save className="mr-1 inline h-4 w-4" />
          Save current query as segment
        </button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">Saved Segments</p>
          <button type="button" className="rounded border border-border px-2 py-1 text-xs text-zinc-200" onClick={() => void loadSegments()}>
            Refresh
          </button>
        </div>
        {loadingSegments ? (
          <p className="text-sm text-zinc-400">Loading segments...</p>
        ) : segments.length === 0 ? (
          <EmptyState icon="filter" title="No saved segments found" description="Run a segment query in builder and save it first." />
        ) : (
          <div className="space-y-2">
            {segments.map((segment) => (
              <article key={segment.id} className="rounded-xl border border-border bg-zinc-900/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{segment.name}</p>
                    <p className="text-xs text-zinc-400">{segment.description ?? "No description"}</p>
                  </div>
                  <StatusBadge label={segment.isArchived ? "archived" : "active"} tone={segment.isArchived ? "warning" : "success"} />
                </div>
                <div className="mt-2 grid gap-2 text-xs text-zinc-300 md:grid-cols-4">
                  <p>Matched: {segment.matchedCount}</p>
                  <p>Last calculated: {new Date(segment.lastCalculatedAt).toLocaleString()}</p>
                  <p>Campaigns using: {segment.campaignsUsing}</p>
                  <p className="truncate">Rules: {JSON.stringify(segment.rulesSummary)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs text-zinc-100"
                    onClick={() => {
                      setQuery(segment.rulesSummary ?? defaultQuery);
                      setEditingSegmentId(segment.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs text-zinc-100"
                    onClick={() => void mutateSegment(segment.id, { action: "duplicate" }, "Segment duplicated")}
                  >
                    <Copy className="mr-1 inline h-3.5 w-3.5" />
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs text-zinc-100"
                    onClick={() => void mutateSegment(segment.id, { isArchived: !segment.isArchived }, segment.isArchived ? "Segment unarchived" : "Segment archived")}
                  >
                    {segment.isArchived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-rose-500/60 px-2 py-1 text-xs text-rose-300"
                    onClick={() => void deleteSegment(segment.id)}
                  >
                    <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                    Delete
                  </button>
                  {editingSegmentId === segment.id ? (
                    <button
                      type="button"
                      className="rounded border border-indigo-500/60 px-2 py-1 text-xs text-indigo-200"
                      onClick={() => void mutateSegment(segment.id, { queryConfig: query }, "Segment updated")}
                    >
                      Save Edit
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-white">Matched Preview (max 50)</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-2 py-1">Email</th>
                <th className="px-2 py-1">Domain</th>
                <th className="px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {(queryResult?.sample ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border/70 text-zinc-200">
                  <td className="px-2 py-1">{row.email}</td>
                  <td className="px-2 py-1">{row.domain}</td>
                  <td className="px-2 py-1">{row.status}</td>
                </tr>
              ))}
              {(queryResult?.sample ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-3 text-center text-zinc-500">
                    Run query to preview.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${checked ? "border-indigo-500/70 bg-indigo-500/10 text-indigo-200" : "border-border bg-zinc-950 text-zinc-300"}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-zinc-900/50 px-2 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900" onClick={onClick}>
      <Download className="mr-1 inline h-3.5 w-3.5" />
      {label}
    </button>
  );
}
