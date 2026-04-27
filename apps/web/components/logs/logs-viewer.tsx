"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Copy, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/notification-provider";

type Severity = "success" | "warning" | "danger" | "info" | "muted";

type LogItem = {
  id: string;
  createdAt: string;
  source: string;
  event: string;
  severity: "success" | "warning" | "error" | "info";
  entityType: string;
  message: string | null;
  metadata: unknown;
  campaignId: string | null;
  recipientId: string | null;
  resourceId: string | null;
};

type LogsResponse = {
  ok: boolean;
  items: LogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  events: string[];
  error?: string;
};

type Filters = {
  q: string;
  type: string;
  severity: string;
  range: string;
  from: string;
  to: string;
  event: string;
  page: number;
  pageSize: number;
};

const DEFAULT_FILTERS: Filters = {
  q: "",
  type: "all",
  severity: "all",
  range: "7d",
  from: "",
  to: "",
  event: "",
  page: 1,
  pageSize: 25
};

function tone(severity: string): Severity {
  if (severity === "success") return "success";
  if (severity === "warning") return "warning";
  if (severity === "error") return "danger";
  if (severity === "info") return "info";
  return "muted";
}

export function LogsViewer() {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<LogsResponse | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(filters.page));
    params.set("pageSize", String(filters.pageSize));
    params.set("type", filters.type);
    params.set("severity", filters.severity);
    params.set("range", filters.range);
    if (filters.q) params.set("q", filters.q);
    if (filters.event) params.set("event", filters.event);
    if (filters.range === "custom") {
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
    }
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/logs?${queryString}`);
        const payload = (await res.json().catch(() => ({}))) as Partial<LogsResponse>;
        if (!res.ok || !payload.ok) {
          throw new Error(payload.error ?? "Log sorgusu başarısız.");
        }
        if (!cancelled) {
          setResponse(payload as LogsResponse);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Log sorgusu başarısız.";
        if (!cancelled) {
          setError(message);
          toast.error("Logs yüklenemedi", message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [queryString, refreshTick]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => setRefreshTick((x) => x + 1), 10_000);
    return () => window.clearInterval(id);
  }, [autoRefresh]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-8">
          <input
            value={draftFilters.q}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, q: e.target.value }))}
            placeholder="Search text..."
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm xl:col-span-2"
          />
          <select
            value={draftFilters.type}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, type: e.target.value }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="all">all</option>
            <option value="campaign">campaign</option>
            <option value="audit">audit</option>
            <option value="worker">worker</option>
            <option value="smtp">smtp</option>
            <option value="list">list</option>
            <option value="template">template</option>
            <option value="suppression">suppression</option>
          </select>
          <select
            value={draftFilters.severity}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, severity: e.target.value }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="all">all</option>
            <option value="success">success</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
            <option value="info">info</option>
          </select>
          <select
            value={draftFilters.range}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, range: e.target.value }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
            <option value="custom">custom</option>
          </select>
          <select
            value={draftFilters.event}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, event: e.target.value }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="">all events/actions</option>
            {(response?.events ?? []).map((event) => (
              <option key={event} value={event}>
                {event}
              </option>
            ))}
          </select>
          <select
            value={String(draftFilters.pageSize)}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, pageSize: Number(e.target.value), page: 1 }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
          <button
            type="button"
            onClick={() => setFilters({ ...draftFilters, page: 1 })}
            className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200"
          >
            Apply
          </button>
        </div>

        {draftFilters.range === "custom" ? (
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <input
              type="datetime-local"
              value={draftFilters.from}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, from: e.target.value }))}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={draftFilters.to}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, to: e.target.value }))}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            />
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <p>
            Total: {response?.total ?? 0} · Page {response?.page ?? 1}/{response?.totalPages ?? 1}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRefreshTick((x) => x + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-zinc-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto refresh (10s)
            </label>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="h-10 animate-pulse rounded-lg bg-zinc-900/70" />
            ))}
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-rose-300">
            <p className="font-medium">Log query failed</p>
            <p className="mt-1 text-xs text-zinc-400">{error}</p>
          </div>
        ) : (response?.items.length ?? 0) === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="activity"
              title="Filtreye uygun log bulunamadı"
              description="Filtreleri genişletin veya tarih aralığını artırın."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">Event/Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {response?.items.map((item) => (
                  <tr key={item.id} className="border-t border-border/70 text-zinc-200">
                    <td className="px-3 py-2 text-xs text-zinc-400">{new Date(item.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <p className="font-medium text-zinc-100">{item.event}</p>
                        <p className="text-[11px] text-zinc-500">{item.source}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{item.entityType}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={item.severity} tone={tone(item.severity)} />
                    </td>
                    <td className="max-w-[480px] truncate px-3 py-2 text-xs text-zinc-300">{item.message || "-"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedLog(item)}
                        className="rounded border border-border px-2 py-1 text-xs text-zinc-200"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between text-xs text-zinc-400">
        <p>
          Showing page {response?.page ?? 1} of {response?.totalPages ?? 1}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            disabled={(response?.page ?? 1) <= 1 || loading}
            className="rounded border border-border px-2 py-1 text-zinc-200 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                page: Math.min(response?.totalPages ?? prev.page, prev.page + 1)
              }))
            }
            disabled={(response?.page ?? 1) >= (response?.totalPages ?? 1) || loading}
            className="rounded border border-border px-2 py-1 text-zinc-200 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {selectedLog ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl border border-border/80 bg-[#0f1420] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-100">
                <Activity className="h-4 w-4" />
                <p className="text-sm font-semibold">Log Details</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-md border border-border px-2 py-1 text-xs text-zinc-300"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs text-zinc-300 md:grid-cols-2">
              <p>
                <span className="text-zinc-500">Timestamp:</span> {new Date(selectedLog.createdAt).toLocaleString()}
              </p>
              <p>
                <span className="text-zinc-500">Event:</span> {selectedLog.event}
              </p>
              <p>
                <span className="text-zinc-500">Entity:</span> {selectedLog.entityType}
              </p>
              <p>
                <span className="text-zinc-500">Severity:</span> {selectedLog.severity}
              </p>
              <p>
                <span className="text-zinc-500">Campaign ID:</span> {selectedLog.campaignId ?? "-"}
              </p>
              <p>
                <span className="text-zinc-500">Resource ID:</span> {selectedLog.resourceId ?? "-"}
              </p>
            </div>
            <div className="mt-3 rounded-lg border border-border bg-zinc-900/70 p-3">
              <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Message</p>
              <p className="text-sm text-zinc-200">{selectedLog.message || "-"}</p>
            </div>
            <div className="mt-3 rounded-lg border border-border bg-zinc-900/70 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Metadata JSON</p>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(JSON.stringify(selectedLog.metadata ?? {}, null, 2));
                    toast.success("JSON kopyalandı");
                  }}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-zinc-200"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy JSON
                </button>
              </div>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap text-xs text-zinc-300">
                {JSON.stringify(selectedLog.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
