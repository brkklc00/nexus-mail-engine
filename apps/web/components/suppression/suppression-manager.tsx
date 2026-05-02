"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Loader2, RefreshCw, Search, ShieldMinus, Upload } from "lucide-react";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

type SuppressionStats = {
  totalSuppressed: number;
  invalidAddress: number;
  hardBounce: number;
  complaint: number;
  blockedRejected: number;
  manual: number;
  alibabaSynced: number;
  addedToday: number;
  addedLast7Days: number;
  lastSyncTime: string | null;
};

type SuppressionRow = {
  id: string;
  email: string;
  reason: string;
  source: string | null;
  scope: string;
  createdAt: string;
};

type QueryResponse = {
  items: SuppressionRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  reasonOptions: string[];
  sourceOptions: string[];
};

type AlibabaSyncResult = {
  ok?: boolean;
  error?: string;
  mode: "real_api" | "mock" | "disabled";
  dateRange: { from: string; to: string };
  normalizedApiRange?: { startTime: string; endTime: string };
  timezone?: string;
  credentialsPresent: boolean;
  apiRequestMade: boolean;
  totalReportsReturned: number;
  scanned: number;
  matched: number;
  added: number;
  removedFromLists: number;
  listRemovalSkipped: number;
  alreadySuppressed: number;
  ignoredTemporary: number;
  ignoredByCategory: number;
  errors: string[];
};

type SyncPreset = "last24h" | "yesterday" | "last3d" | "last7d" | "custom";

type Filters = {
  q: string;
  reason: string;
  source: string;
  scope: string;
  range: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

const DEFAULT_FILTERS: Filters = {
  q: "",
  reason: "",
  source: "",
  scope: "all",
  range: "7d",
  from: "",
  to: "",
  page: 1,
  pageSize: 25
};

function parseBatchText(text: string, maxLines = 8000, maxChars = 220_000): string[] {
  const lines = text
    .replace(/\r/g, "")
    .replace(/[;,]+/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const batches: string[] = [];
  let current: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (current.length >= maxLines || chars + line.length + 1 > maxChars) {
      batches.push(current.join("\n"));
      current = [];
      chars = 0;
    }
    current.push(line);
    chars += line.length + 1;
  }
  if (current.length > 0) batches.push(current.join("\n"));
  return batches;
}

function toDatetimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function computeSyncPresetRange(preset: Exclude<SyncPreset, "custom">): { from: string; to: string } {
  const safeNow = new Date(Date.now() - 10 * 60 * 1000);
  if (preset === "last24h") {
    return {
      from: toDatetimeLocalValue(new Date(safeNow.getTime() - 24 * 60 * 60 * 1000)),
      to: toDatetimeLocalValue(safeNow)
    };
  }
  if (preset === "yesterday") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayEnd = new Date(todayStart.getTime() - 1000);
    return {
      from: toDatetimeLocalValue(yesterdayStart),
      to: toDatetimeLocalValue(yesterdayEnd)
    };
  }
  if (preset === "last3d") {
    return {
      from: toDatetimeLocalValue(new Date(safeNow.getTime() - 3 * 24 * 60 * 60 * 1000)),
      to: toDatetimeLocalValue(safeNow)
    };
  }
  return {
    from: toDatetimeLocalValue(new Date(safeNow.getTime() - 7 * 24 * 60 * 60 * 1000)),
    to: toDatetimeLocalValue(safeNow)
  };
}

export function SuppressionManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const [stats, setStats] = useState<SuppressionStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hasQueried, setHasQueried] = useState(false);
  const [queryData, setQueryData] = useState<QueryResponse | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const [bulkText, setBulkText] = useState("");
  const [bulkReason, setBulkReason] = useState("manual_add");
  const [bulkSource, setBulkSource] = useState("admin-ui");
  const [bulkScope, setBulkScope] = useState("global");
  const [bulkState, setBulkState] = useState<"idle" | "running">("idle");
  const [bulkProgress, setBulkProgress] = useState({
    totalBatches: 0,
    currentBatch: 0,
    processed: 0,
    added: 0,
    duplicates: 0,
    invalidSkipped: 0,
    alreadySuppressed: 0
  });

  const [removeText, setRemoveText] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const [removeSource, setRemoveSource] = useState("");
  const [removeFrom, setRemoveFrom] = useState("");
  const [removeTo, setRemoveTo] = useState("");
  const [removeLoading, setRemoveLoading] = useState(false);

  const [syncPreset, setSyncPreset] = useState<SyncPreset>("yesterday");
  const [syncFrom, setSyncFrom] = useState(() => computeSyncPresetRange("yesterday").from);
  const [syncTo, setSyncTo] = useState(() => computeSyncPresetRange("yesterday").to);
  const [syncCategories, setSyncCategories] = useState<Record<string, boolean>>({
    invalid: true,
    hard_bounce: true,
    complaint: true,
    blocked_rejected: true
  });
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncSummary, setSyncSummary] = useState<AlibabaSyncResult | null>(null);
  const [syncSummaryOpen, setSyncSummaryOpen] = useState(false);
  const [syncRemoveFromLists, setSyncRemoveFromLists] = useState(true);

  const pageSizeOptions = [25, 50, 100];
  const hasFilterInput = useMemo(
    () =>
      Boolean(filters.q || filters.reason || filters.source || filters.scope !== "all" || filters.range !== "7d" || filters.from || filters.to),
    [filters]
  );

  function applySyncPreset(preset: Exclude<SyncPreset, "custom">) {
    const range = computeSyncPresetRange(preset);
    setSyncPreset(preset);
    setSyncFrom(range.from);
    setSyncTo(range.to);
  }

  async function loadStats() {
    setLoadingStats(true);
    try {
      const response = await fetch("/api/suppressions/stats");
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        stats?: SuppressionStats;
      };
      if (!response.ok || !payload.ok || !payload.stats) {
        throw new Error(payload.error ?? "Stats could not be loaded");
      }
      setStats(payload.stats);
    } catch (err) {
      toast.error("Suppression stats could not be loaded", err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoadingStats(false);
    }
  }

  async function runQuery(nextFilters: Filters) {
    setQueryLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(nextFilters.page));
    params.set("pageSize", String(nextFilters.pageSize));
    params.set("range", nextFilters.range);
    if (nextFilters.q) params.set("q", nextFilters.q);
    if (nextFilters.reason) params.set("reason", nextFilters.reason);
    if (nextFilters.source) params.set("source", nextFilters.source);
    if (nextFilters.scope && nextFilters.scope !== "all") params.set("scope", nextFilters.scope);
    if (nextFilters.range === "custom") {
      if (nextFilters.from) params.set("from", nextFilters.from);
      if (nextFilters.to) params.set("to", nextFilters.to);
    }
    try {
      const response = await fetch(`/api/suppressions?${params.toString()}`);
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      } & QueryResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Suppression query failed");
      }
      setQueryData({
        items: payload.items,
        total: payload.total,
        page: payload.page,
        pageSize: payload.pageSize,
        totalPages: payload.totalPages,
        reasonOptions: payload.reasonOptions,
        sourceOptions: payload.sourceOptions
      });
      setHasQueried(true);
    } catch (err) {
      toast.error("Suppression query failed", err instanceof Error ? err.message : "Request failed");
    } finally {
      setQueryLoading(false);
    }
  }

  async function submitBulkAdd() {
    if (!bulkText.trim()) return;
    const accepted = await confirm({
      title: "Run bulk suppression import?",
      message: "Entries will be processed in batches.",
      confirmLabel: "Import",
      cancelLabel: "Cancel",
      tone: "warning"
    });
    if (!accepted) return;

    const batches = parseBatchText(bulkText, 8000, 220_000);
    if (batches.length === 0) return;

    setBulkState("running");
    let aggregate = {
      totalBatches: batches.length,
      currentBatch: 0,
      processed: 0,
      added: 0,
      duplicates: 0,
      invalidSkipped: 0,
      alreadySuppressed: 0
    };
    setBulkProgress(aggregate);

    for (let i = 0; i < batches.length; i += 1) {
      const response = await fetch("/api/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: batches[i],
          reason: bulkReason,
          source: bulkSource,
          scope: bulkScope
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        summary?: {
          processed: number;
          added: number;
          duplicates: number;
          invalidSkipped: number;
          alreadySuppressed: number;
        };
      };
      if (!response.ok || !payload.ok || !payload.summary) {
        toast.error("Bulk import failed", payload.error ?? "Operation stopped midway");
        setBulkState("idle");
        return;
      }
      aggregate = {
        ...aggregate,
        currentBatch: i + 1,
        processed: aggregate.processed + payload.summary.processed,
        added: aggregate.added + payload.summary.added,
        duplicates: aggregate.duplicates + payload.summary.duplicates,
        invalidSkipped: aggregate.invalidSkipped + payload.summary.invalidSkipped,
        alreadySuppressed: aggregate.alreadySuppressed + payload.summary.alreadySuppressed
      };
      setBulkProgress(aggregate);
    }

    toast.success(
      "Bulk import completed",
      `processed ${aggregate.processed}, added ${aggregate.added}, duplicates ${aggregate.duplicates}, invalid ${aggregate.invalidSkipped}, already suppressed ${aggregate.alreadySuppressed}`
    );
    setBulkText("");
    setBulkState("idle");
    await loadStats();
    const postImportFilters: Filters = {
      ...filters,
      q: "",
      reason: bulkReason,
      source: bulkSource,
      scope: bulkScope,
      range: "24h",
      from: "",
      to: "",
      page: 1
    };
    setFilters(postImportFilters);
    setDraftFilters(postImportFilters);
    await runQuery(postImportFilters);
  }

  async function submitBulkRemove() {
    if (!removeText.trim()) return;
    const accepted = await confirm({
      title: "Run suppression bulk remove?",
      message: "Global suppression records will be removed based on input.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      tone: "danger"
    });
    if (!accepted) return;
    setRemoveLoading(true);
    try {
      const response = await fetch("/api/suppressions/bulk-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: removeText,
          reason: removeReason || undefined,
          source: removeSource || undefined,
          from: removeFrom || undefined,
          to: removeTo || undefined
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        summary?: {
          processed: number;
          removed: number;
          notFound: number;
          invalidInput: number;
        };
      };
      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.error ?? "Bulk remove failed");
      }
      toast.info(
        "Bulk remove completed",
        `processed ${payload.summary.processed}, removed ${payload.summary.removed}, not found ${payload.summary.notFound}, invalid ${payload.summary.invalidInput}`
      );
      setRemoveText("");
      await loadStats();
      if (hasQueried || hasFilterInput) {
        await runQuery({ ...filters, page: 1 });
      }
    } catch (err) {
      toast.error("Bulk remove failed", err instanceof Error ? err.message : "Request failed");
    } finally {
      setRemoveLoading(false);
    }
  }

  async function runAlibabaSync() {
    const categories = Object.entries(syncCategories)
      .filter(([, checked]) => checked)
      .map(([key]) => key);
    if (categories.length === 0) {
      toast.warning("Select at least one category");
      return;
    }
    const accepted = await confirm({
      title: "Start Alibaba DirectMail sync?",
      message: "Temporary failures are ignored; permanent categories are added to suppression.",
      confirmLabel: "Sync",
      cancelLabel: "Cancel",
      tone: "warning"
    });
    if (!accepted) return;

    setSyncLoading(true);
    try {
      const response = await fetch("/api/suppressions/sync-alibaba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: syncFrom,
          to: syncTo,
          categories,
          removeFromLists: syncRemoveFromLists
        })
      });
      const payload = (await response.json().catch(() => ({}))) as AlibabaSyncResult;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Alibaba sync failed");
      }
      setSyncSummary(payload);
      setSyncSummaryOpen(true);
      const statusText =
        payload.mode === "disabled"
          ? "Alibaba sync is disabled by configuration."
          : payload.mode === "mock"
            ? "Alibaba sync is not connected to the real API yet."
            : !payload.credentialsPresent
              ? "Alibaba credentials are not configured."
              : payload.errors.some((item) => /specified date is invalid|invalid date/i.test(item))
                ? "Alibaba date rejected. Check final StartTime/EndTime in sync summary."
              : payload.apiRequestMade && payload.totalReportsReturned === 0
                ? "Alibaba API connected, but no failed delivery reports were found for the selected date range."
                : `Scanned ${payload.scanned}, matched ${payload.matched}, added ${payload.added}, removed from lists ${payload.removedFromLists}.`;
      toast.success("Alibaba sync completed", statusText);
      await loadStats();
      if (hasQueried || hasFilterInput) {
        await runQuery({ ...filters, page: 1 });
      }
    } catch (err) {
      toast.error("Alibaba sync failed", err instanceof Error ? err.message : "Request failed");
    } finally {
      setSyncLoading(false);
    }
  }

  async function removeSingle(id: string) {
    const accepted = await confirm({
      title: "Remove suppression record?",
      message: "The record will be removed from suppression.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      tone: "danger"
    });
    if (!accepted) return;

    const response = await fetch(`/api/suppressions/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Record could not be removed", payload.error ?? "Request failed");
      return;
    }
    toast.info("Suppression record removed");
    await loadStats();
    if (hasQueried) {
      await runQuery(filters);
    }
  }

  useEffect(() => {
    void loadStats();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">Scalable suppression management center</p>
        <button
          type="button"
          onClick={() => void loadStats()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingStats ? "animate-spin" : ""}`} />
          Refresh stats
        </button>
      </div>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <StatCard title="Total suppressed" value={stats?.totalSuppressed ?? 0} />
        <StatCard title="Invalid address" value={stats?.invalidAddress ?? 0} />
        <StatCard title="Hard bounce" value={stats?.hardBounce ?? 0} />
        <StatCard title="Complaint" value={stats?.complaint ?? 0} />
        <StatCard title="Blocked/rejected" value={stats?.blockedRejected ?? 0} />
        <StatCard title="Manual" value={stats?.manual ?? 0} />
        <StatCard title="Alibaba synced" value={stats?.alibabaSynced ?? 0} />
        <StatCard title="Added today" value={stats?.addedToday ?? 0} />
        <StatCard title="Added 7d" value={stats?.addedLast7Days ?? 0} />
        <StatCard title="Last sync time" value={stats?.lastSyncTime ? new Date(stats.lastSyncTime).toLocaleString() : "-"} isText />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-zinc-200">Search & Filter</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-8">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              value={draftFilters.q}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, q: e.target.value }))}
              placeholder="Search email..."
              className="w-full rounded-lg border border-border bg-zinc-900/70 py-2 pl-8 pr-3 text-sm"
            />
          </div>
          <select
            value={draftFilters.reason}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, reason: e.target.value }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="">all reasons</option>
            {(queryData?.reasonOptions ?? []).map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
          <select
            value={draftFilters.source}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, source: e.target.value }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="">all sources</option>
            {(queryData?.sourceOptions ?? []).map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <select
            value={draftFilters.scope}
            onChange={(e) => setDraftFilters((prev) => ({ ...prev, scope: e.target.value }))}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="all">all scopes</option>
            <option value="global">global</option>
            <option value="list">list</option>
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
            onClick={() => {
              const next = { ...draftFilters, page: 1 };
              setFilters(next);
              void runQuery(next);
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200"
          >
            Search
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
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Bulk Add Suppression</p>
          <textarea
            rows={5}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="one email per line or mixed text"
            className="mt-2 w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          />
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            <input
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              placeholder="reason"
            />
            <input
              value={bulkSource}
              onChange={(e) => setBulkSource(e.target.value)}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              placeholder="source"
            />
            <select
              value={bulkScope}
              onChange={(e) => setBulkScope(e.target.value)}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            >
              <option value="global">global</option>
              <option value="list">list</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void submitBulkAdd()}
            disabled={bulkState === "running"}
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
          >
            {bulkState === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import
          </button>
          {bulkProgress.totalBatches > 0 ? (
            <p className="mt-2 text-xs text-zinc-400">
              batch {bulkProgress.currentBatch}/{bulkProgress.totalBatches} · processed {bulkProgress.processed} ·
              added {bulkProgress.added} · duplicates {bulkProgress.duplicates} · invalid {bulkProgress.invalidSkipped}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Bulk Remove From Global Suppression</p>
          <textarea
            rows={5}
            value={removeText}
            onChange={(e) => setRemoveText(e.target.value)}
            placeholder="paste emails line-by-line"
            className="mt-2 w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          />
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <input
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              placeholder="filter by reason (optional)"
            />
            <input
              value={removeSource}
              onChange={(e) => setRemoveSource(e.target.value)}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              placeholder="filter by source (optional)"
            />
            <input
              type="datetime-local"
              value={removeFrom}
              onChange={(e) => setRemoveFrom(e.target.value)}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={removeTo}
              onChange={(e) => setRemoveTo(e.target.value)}
              className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void submitBulkRemove()}
            disabled={removeLoading}
            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-400/40 px-3 py-2 text-sm text-rose-200 disabled:opacity-60"
          >
            {removeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldMinus className="h-4 w-4" />}
            Remove from suppression
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Alibaba DirectMail Sync</p>
          <button
            type="button"
            onClick={() => void runAlibabaSync()}
            disabled={syncLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
          >
            {syncLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync failed reports
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <input
            type="datetime-local"
            value={syncFrom}
            onChange={(e) => {
              setSyncPreset("custom");
              setSyncFrom(e.target.value);
            }}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={syncTo}
            onChange={(e) => {
              setSyncPreset("custom");
              setSyncTo(e.target.value);
            }}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { id: "last24h" as const, label: "Last 24 hours" },
            { id: "yesterday" as const, label: "Yesterday" },
            { id: "last3d" as const, label: "Last 3 days" },
            { id: "last7d" as const, label: "Last 7 days" }
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applySyncPreset(preset.id)}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                syncPreset === preset.id
                  ? "border-indigo-400/50 bg-indigo-500/10 text-indigo-200"
                  : "border-border text-zinc-300"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-300">
          {[
            ["invalid", "invalid"],
            ["hard_bounce", "hard bounce"],
            ["complaint", "complaint"],
            ["blocked_rejected", "blocked/rejected"]
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={syncCategories[key]}
                onChange={(e) => setSyncCategories((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">Temporary failures are reported as ignored during sync and are not added to suppression.</p>
        <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={syncRemoveFromLists}
            onChange={(e) => setSyncRemoveFromLists(e.target.checked)}
          />
          Also remove suppressed emails from all recipient lists
        </label>
        {syncSummary ? (
          <p className="mt-2 text-xs text-zinc-300">
            Last run: mode {syncSummary.mode}, reports {syncSummary.totalReportsReturned}, added {syncSummary.added}, removed {syncSummary.removedFromLists}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card">
        {!hasQueried ? (
          <div className="p-4">
            <EmptyState
              icon="ban"
              title="Search or import suppression data to view records."
              description="The default view does not list all suppression records."
            />
          </div>
        ) : queryLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="h-10 animate-pulse rounded-lg bg-zinc-900/70" />
            ))}
          </div>
        ) : (queryData?.items.length ?? 0) === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="ban"
              title="No records found"
              description="Change filters or expand the date range."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {queryData?.items.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/70 text-zinc-200">
                    <td className="px-4 py-3 font-medium text-white">{entry.email}</td>
                    <td className="px-4 py-3">{entry.reason}</td>
                    <td className="px-4 py-3 text-zinc-400">{entry.source ?? "-"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={entry.scope} tone={entry.scope === "global" ? "danger" : "warning"} />
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => void removeSingle(entry.id)} className="text-rose-300">
                        <Ban className="inline h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hasQueried && queryData ? (
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <p>
            Total {queryData.total} · page {queryData.page}/{queryData.totalPages}
          </p>
          <div className="flex gap-2">
            <select
              value={String(filters.pageSize)}
              onChange={(e) => {
                const next = { ...filters, pageSize: Number(e.target.value), page: 1 };
                setFilters(next);
                setDraftFilters((prev) => ({ ...prev, pageSize: next.pageSize, page: 1 }));
                void runQuery(next);
              }}
              className="rounded border border-border bg-zinc-900/70 px-2 py-1"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={filters.page <= 1}
              onClick={() => {
                const next = { ...filters, page: Math.max(1, filters.page - 1) };
                setFilters(next);
                void runQuery(next);
              }}
              className="rounded border border-border px-2 py-1 text-zinc-200 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={filters.page >= queryData.totalPages}
              onClick={() => {
                const next = { ...filters, page: Math.min(queryData.totalPages, filters.page + 1) };
                setFilters(next);
                void runQuery(next);
              }}
              className="rounded border border-border px-2 py-1 text-zinc-200 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {syncSummaryOpen && syncSummary ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/80 bg-[#0f1420] p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-zinc-100">Alibaba Sync Summary</h3>
            <div className="mt-2 space-y-1 text-sm text-zinc-300">
              <p>
                Date range: {new Date(syncSummary.dateRange.from).toLocaleString()} - {new Date(syncSummary.dateRange.to).toLocaleString()}
              </p>
              {syncSummary.normalizedApiRange ? (
                <p>
                  API range: StartTime={syncSummary.normalizedApiRange.startTime} | EndTime={syncSummary.normalizedApiRange.endTime}
                </p>
              ) : null}
              <p>Mode: {syncSummary.mode === "real_api" ? "Real API" : syncSummary.mode === "mock" ? "Mock" : "Disabled"}</p>
              <p>Credentials configured: {syncSummary.credentialsPresent ? "Yes" : "No"}</p>
              <p>Alibaba API request made: {syncSummary.apiRequestMade ? "Yes" : "No"}</p>
              <p>Total reports returned: {syncSummary.totalReportsReturned}</p>
              <p>
                Scanned: {syncSummary.scanned} | Matched: {syncSummary.matched} | Added: {syncSummary.added}
              </p>
              <p>
                Removed from lists: {syncSummary.removedFromLists} | List removal skipped: {syncSummary.listRemovalSkipped}
              </p>
              <p>
                Already suppressed: {syncSummary.alreadySuppressed} | Ignored temporary: {syncSummary.ignoredTemporary} | Ignored by category:{" "}
                {syncSummary.ignoredByCategory}
              </p>
              {syncSummary.mode === "mock" ? (
                <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                  Alibaba sync is not connected to the real API yet.
                </p>
              ) : null}
              {syncSummary.mode === "disabled" ? (
                <p className="rounded border border-zinc-500/30 bg-zinc-500/10 p-2 text-zinc-200">
                  Alibaba sync is disabled by configuration.
                </p>
              ) : null}
              {syncSummary.mode === "real_api" && !syncSummary.credentialsPresent ? (
                <p className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-200">
                  Alibaba credentials are not configured.
                </p>
              ) : null}
              {syncSummary.mode === "real_api" &&
              syncSummary.credentialsPresent &&
              syncSummary.apiRequestMade &&
              syncSummary.totalReportsReturned === 0 ? (
                <p className="rounded border border-indigo-500/30 bg-indigo-500/10 p-2 text-indigo-200">
                  Alibaba API connected, but no failed delivery reports were found for the selected date range.
                </p>
              ) : null}
              {syncSummary.mode === "real_api" &&
              syncSummary.credentialsPresent &&
              syncSummary.apiRequestMade &&
              syncSummary.errors.some((item) => /specified date is invalid|invalid date/i.test(item)) ? (
                <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                  Date format adjusted to Alibaba API requirements.
                </p>
              ) : null}
              {syncSummary.errors.length > 0 ? (
                <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-200">
                  <p className="font-medium">Errors</p>
                  {syncSummary.errors.map((item) => (
                    <p key={item}>- {item}</p>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSyncSummaryOpen(false)}
                className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ title, value, isText = false }: { title: string; value: number | string; isText?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</p>
      <p className={`${isText ? "text-xs" : "text-base"} font-semibold text-zinc-100`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
