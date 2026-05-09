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

type AlibabaSyncStatus = {
  status:
    | "idle"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "stopped_limit";
  startTime: string;
  endTime: string;
  totalCount: number;
  pagesFetched: number;
  rawRecords: number;
  parsedEmails: number;
  addedToSuppression: number;
  alreadySuppressed: number;
  removedFromLists: number;
  invalidEmailSkipped: number;
  ignoredTemporary: number;
  ignoredUnknown: number;
  hasNextStart: boolean;
  nextStartHash: string | null;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  message: string;
  responseKeys: string[];
  firstRecordKeys: string[];
  parserPathUsed: string | null;
};

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

function toDateOnlyValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeSyncPresetRange(preset: "yesterday" | "last7d" | "last30d"): { from: string; to: string } {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayEnd = new Date(todayStart.getTime() - 1000);
  if (preset === "yesterday") {
    return {
      from: toDateOnlyValue(yesterdayStart),
      to: toDateOnlyValue(yesterdayEnd)
    };
  }
  if (preset === "last7d") {
    return {
      from: toDateOnlyValue(new Date(yesterdayStart.getTime() - 6 * 24 * 60 * 60 * 1000)),
      to: toDateOnlyValue(yesterdayEnd)
    };
  }
  return {
    from: toDateOnlyValue(new Date(yesterdayStart.getTime() - 29 * 24 * 60 * 60 * 1000)),
    to: toDateOnlyValue(yesterdayEnd)
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

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncRemoveFromLists, setSyncRemoveFromLists] = useState(true);
  const [syncStatus, setSyncStatus] = useState<AlibabaSyncStatus | null>(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [syncTechnicalOpen, setSyncTechnicalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"txt" | "csv">("txt");
  const [exportScope, setExportScope] = useState<"all" | "filtered" | "selected">("filtered");
  const [exportReason, setExportReason] = useState("all");
  const [exportSource, setExportSource] = useState("all");
  const [exportDateRange, setExportDateRange] = useState("all");
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [bulkRemoveModalOpen, setBulkRemoveModalOpen] = useState(false);
  const [bulkRemoveMode, setBulkRemoveMode] = useState<"emails" | "selected" | "filtered">("emails");
  const [bulkRemoveText, setBulkRemoveText] = useState("");
  const [bulkRemoveConfirm, setBulkRemoveConfirm] = useState(false);
  const [bulkRemoveLoading, setBulkRemoveLoading] = useState(false);

  const pageSizeOptions = [25, 50, 100];
  const hasFilterInput = useMemo(
    () =>
      Boolean(filters.q || filters.reason || filters.source || filters.scope !== "all" || filters.range !== "7d" || filters.from || filters.to),
    [filters]
  );

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
      toast.error("Baskilama istatistikleri yuklenemedi", err instanceof Error ? err.message : "Istek basarisiz oldu");
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadAlibabaSyncStatus() {
    setSyncStatusLoading(true);
    try {
      const response = await fetch("/api/suppression/alibaba-sync/status", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        summary?: AlibabaSyncStatus;
      };
      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.error ?? "Alibaba senkronizasyon durumu alınamadı");
      }
      setSyncStatus(payload.summary);
    } catch (err) {
      toast.error("Alibaba senkronizasyon durumu alınamadı", err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setSyncStatusLoading(false);
    }
  }

  async function startAlibabaSyncLast30Days() {
    const range = computeSyncPresetRange("last30d");
    setSyncLoading(true);
    try {
      const response = await fetch("/api/suppression/alibaba-sync/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: range.from,
          endTime: range.to,
          removeFromLists: syncRemoveFromLists
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; summary?: AlibabaSyncStatus };
      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.error ?? "Alibaba senkronizasyonu başlatılamadı");
      }
      setSyncStatus(payload.summary);
      toast.success("Alibaba senkronizasyonu başlatıldı", payload.summary.message);
      await loadStats();
    } catch (err) {
      toast.error("Alibaba senkronizasyonu başlatılamadı", err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setSyncLoading(false);
    }
  }

  async function continueAlibabaSync() {
    setSyncLoading(true);
    try {
      const response = await fetch("/api/suppression/alibaba-sync/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeFromLists: syncRemoveFromLists })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; summary?: AlibabaSyncStatus };
      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.error ?? "Alibaba senkronizasyonu devam ettirilemedi");
      }
      setSyncStatus(payload.summary);
      toast.success("Alibaba senkronizasyonu devam etti", payload.summary.message);
      await loadStats();
    } catch (err) {
      toast.error("Alibaba senkronizasyonu devam ettirilemedi", err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setSyncLoading(false);
    }
  }

  async function resetAlibabaSync() {
    const accepted = await confirm({
      title: "Alibaba senkronizasyonu sıfırlansın mı?",
      message: "Kayıtlı nextStart/devam durumu temizlenecek.",
      confirmLabel: "Sıfırla",
      cancelLabel: "İptal",
      tone: "danger"
    });
    if (!accepted) return;
    setSyncLoading(true);
    try {
      const response = await fetch("/api/suppression/alibaba-sync/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; summary?: AlibabaSyncStatus };
      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.error ?? "Sıfırlama başarısız oldu");
      }
      setSyncStatus(payload.summary);
      toast.info("Alibaba senkronizasyon durumu sıfırlandı");
      await loadStats();
    } catch (err) {
      toast.error("Senkronizasyon sıfırlanamadı", err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setSyncLoading(false);
    }
  }

  function toggleSelection(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleCurrentPageSelection(checked: boolean) {
    const ids = queryData?.items.map((row) => row.id) ?? [];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function runExport() {
    setExportLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("format", exportFormat);
      params.set("scope", exportScope);
      params.set("reason", exportReason);
      params.set("source", exportSource);
      params.set("dateRange", exportDateRange);
      if (exportDateRange === "custom") {
        if (exportStartDate) params.set("startDate", exportStartDate);
        if (exportEndDate) params.set("endDate", exportEndDate);
      }
      params.set("search", filters.q);
      params.set("scopeFilter", filters.scope);
      if (exportScope === "selected") {
        params.set("ids", [...selectedIds].join(","));
      }
      const response = await fetch(`/api/suppression/export?${params.toString()}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Dışa aktarma başarısız oldu");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `suppression-export-${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Toplu indirme hazırlandı");
      setExportModalOpen(false);
    } catch (err) {
      toast.error("Toplu indirme başarısız", err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setExportLoading(false);
    }
  }

  async function runBulkRemoveV2() {
    if (!bulkRemoveConfirm) {
      toast.warning("Lütfen onay kutusunu işaretleyin.");
      return;
    }
    setBulkRemoveLoading(true);
    try {
      let emails: string[] = [];
      if (bulkRemoveMode === "emails") {
        emails = bulkRemoveText
          .replace(/[;,]+/g, "\n")
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
      const response = await fetch("/api/suppression/bulk-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: bulkRemoveMode,
          emails,
          ids: bulkRemoveMode === "selected" ? [...selectedIds] : [],
          filters:
            bulkRemoveMode === "filtered"
              ? {
                  search: filters.q,
                  reason: filters.reason || "all",
                  source: filters.source || "all",
                  scope: filters.scope || "all",
                  dateRange: filters.range,
                  startDate: filters.from,
                  endDate: filters.to
                }
              : undefined,
          confirm: true
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        scanned?: number;
        validEmails?: number;
        invalidSkipped?: number;
        duplicatesSkipped?: number;
        removed?: number;
        notFound?: number;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Toplu çıkartma başarısız");
      }
      toast.success(
        "Toplu çıkartma tamamlandı",
        `${payload.scanned ?? 0} e-posta tarandı, ${payload.validEmails ?? 0} geçerli bulundu, ${payload.removed ?? 0} kayıt baskılama listesinden çıkarıldı.`
      );
      setBulkRemoveModalOpen(false);
      setBulkRemoveText("");
      setBulkRemoveConfirm(false);
      setSelectedIds(new Set());
      await loadStats();
      if (hasQueried) await runQuery({ ...filters, page: 1 });
    } catch (err) {
      toast.error("Toplu çıkartma başarısız", err instanceof Error ? err.message : "İstek başarısız oldu");
    } finally {
      setBulkRemoveLoading(false);
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
        throw new Error(payload.error ?? "Baskilama sorgusu basarisiz oldu");
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
      toast.error("Baskilama sorgusu basarisiz oldu", err instanceof Error ? err.message : "Istek basarisiz oldu");
    } finally {
      setQueryLoading(false);
    }
  }

  async function submitBulkAdd() {
    if (!bulkText.trim()) return;
    const accepted = await confirm({
      title: "Run bulk suppression import?",
      message: "Entries will be processed in batches.",
      confirmLabel: "Ice Aktar",
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
        toast.error("Toplu ice aktarma basarisiz", payload.error ?? "Islem yarida durdu");
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
      confirmLabel: "Sil",
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
        throw new Error(payload.error ?? "Toplu silme basarisiz oldu");
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
      toast.error("Toplu silme basarisiz", err instanceof Error ? err.message : "Istek basarisiz oldu");
    } finally {
      setRemoveLoading(false);
    }
  }

  async function removeSingle(id: string) {
    const accepted = await confirm({
      title: "Baskilama kaydi silinsin mi?",
      message: "The record will be removed from suppression.",
      confirmLabel: "Sil",
      cancelLabel: "Cancel",
      tone: "danger"
    });
    if (!accepted) return;

    const response = await fetch(`/api/suppressions/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Kayit silinemedi", payload.error ?? "Istek basarisiz oldu");
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
    void loadAlibabaSyncStatus();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">Baskılama operasyon merkezi</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-200"
          >
            Toplu İndir
          </button>
          <button
            type="button"
            onClick={() => setBulkRemoveModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200"
          >
            Toplu Çıkart
          </button>
          <button
            type="button"
            onClick={() => {
              void loadStats();
              void loadAlibabaSyncStatus();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-zinc-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingStats || syncStatusLoading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>
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
              placeholder="E-posta ara..."
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
          <p className="text-xs uppercase tracking-wide text-zinc-400">Alibaba Invalid Adres Senkronizasyonu</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startAlibabaSyncLast30Days()}
              disabled={syncLoading || syncStatus?.status === "running"}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
            >
              {syncLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Son 30 Günü Başlat
            </button>
            <button
              type="button"
              onClick={() => void continueAlibabaSync()}
              disabled={syncLoading || !syncStatus?.hasNextStart}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/40 px-3 py-2 text-sm text-indigo-200 disabled:opacity-60"
            >
              Devam Et
            </button>
            <button
              type="button"
              onClick={() => setSyncTechnicalOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200"
            >
              Teknik Detayları Göster
            </button>
            <button
              type="button"
              onClick={() => void resetAlibabaSync()}
              disabled={syncLoading}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-200 disabled:opacity-60"
            >
              Sıfırla
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          QueryInvalidAddress yalnızca Alibaba invalid address listesini döndürür. Tüm gönderim hataları için
          SenderStatisticsDetailByParam entegrasyonu ayrıca kullanılmalıdır.
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={syncRemoveFromLists}
            onChange={(e) => setSyncRemoveFromLists(e.target.checked)}
          />
          Eklenen baskilanan e-postalari tum alici listelerinden de kaldir
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300 md:grid-cols-5">
          <StatCard title="Durum" value={syncStatus?.status ?? "-"} isText />
          <StatCard title="TotalCount" value={syncStatus?.totalCount ?? 0} />
          <StatCard title="İşlenen Sayfa" value={syncStatus?.pagesFetched ?? 0} />
          <StatCard title="İşlenen Kayıt" value={syncStatus?.rawRecords ?? 0} />
          <StatCard title="Parse Edilen E-posta" value={syncStatus?.parsedEmails ?? 0} />
          <StatCard title="Eklenen" value={syncStatus?.addedToSuppression ?? 0} />
          <StatCard title="Zaten Kayıtlı" value={syncStatus?.alreadySuppressed ?? 0} />
          <StatCard title="Listeden Çıkarılan" value={syncStatus?.removedFromLists ?? 0} />
          <StatCard title="Devam Bilgisi" value={syncStatus?.hasNextStart ? "Var" : "Yok"} isText />
          <StatCard title="Son Güncelleme" value={syncStatus?.updatedAt ? new Date(syncStatus.updatedAt).toLocaleString() : "-"} isText />
        </div>
        <p className="mt-2 text-xs text-zinc-400">{syncStatus?.message ?? "Henüz senkronizasyon başlatılmadı."}</p>
        {syncTechnicalOpen ? (
          <div className="mt-2 rounded-lg border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
            <p>responseKeys: {(syncStatus?.responseKeys ?? []).join(", ") || "-"}</p>
            <p>firstRecordKeys: {(syncStatus?.firstRecordKeys ?? []).join(", ") || "-"}</p>
            <p>parser path used: {syncStatus?.parserPathUsed ?? "-"}</p>
            <p>hasNextStart: {syncStatus?.hasNextStart ? "true" : "false"}</p>
            <p>nextStartHash: {syncStatus?.nextStartHash ?? "-"}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card">
        {!hasQueried ? (
          <div className="p-4">
            <EmptyState
              icon="ban"
              title="Kayitlari goruntulemek icin baskilama verisini arayin veya ice aktarim yapin."
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
              title="Kayit bulunamadi"
              description="Change filters or expand the date range."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-zinc-300">
              <p>{selectedIds.size} kayıt seçildi</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExportScope("selected");
                    setExportModalOpen(true);
                  }}
                  disabled={selectedIds.size === 0}
                  className="rounded border border-border px-2 py-1 disabled:opacity-50"
                >
                  Seçilileri İndir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkRemoveMode("selected");
                    setBulkRemoveModalOpen(true);
                  }}
                  disabled={selectedIds.size === 0}
                  className="rounded border border-rose-500/40 px-2 py-1 text-rose-200 disabled:opacity-50"
                >
                  Seçilileri Çıkart
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={(queryData?.items.length ?? 0) > 0 && (queryData?.items.every((item) => selectedIds.has(item.id)) ?? false)}
                      onChange={(event) => toggleCurrentPageSelection(event.target.checked)}
                    />
                  </th>
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
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(entry.id)}
                        onChange={(event) => toggleSelection(entry.id, event.target.checked)}
                      />
                    </td>
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

      {exportModalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-[#0f1420] p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Baskılama Listesini İndir</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="text-xs text-zinc-300">
                Format
                <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "txt" | "csv")} className="mt-1 w-full rounded border border-border bg-zinc-900/70 px-2 py-2">
                  <option value="txt">TXT</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Kapsam
                <select value={exportScope} onChange={(e) => setExportScope(e.target.value as "all" | "filtered" | "selected")} className="mt-1 w-full rounded border border-border bg-zinc-900/70 px-2 py-2">
                  <option value="all">Tüm kayıtlar</option>
                  <option value="filtered">Filtrelenmiş kayıtlar</option>
                  <option value="selected">Seçili kayıtlar</option>
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Sebep
                <select value={exportReason} onChange={(e) => setExportReason(e.target.value)} className="mt-1 w-full rounded border border-border bg-zinc-900/70 px-2 py-2">
                  <option value="all">Tüm nedenler</option>
                  <option value="invalid_address">invalid_address</option>
                  <option value="hard_bounce">hard_bounce</option>
                  <option value="complaint">complaint</option>
                  <option value="unsubscribe">unsubscribe</option>
                  <option value="blocked/rejected">blocked/rejected</option>
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Kaynak
                <select value={exportSource} onChange={(e) => setExportSource(e.target.value)} className="mt-1 w-full rounded border border-border bg-zinc-900/70 px-2 py-2">
                  <option value="all">Tüm kaynaklar</option>
                  <option value="manual">manual</option>
                  <option value="alibaba_query_invalid_address">alibaba_query_invalid_address</option>
                  <option value="unsubscribe_page">unsubscribe_page</option>
                </select>
              </label>
              <label className="text-xs text-zinc-300">
                Tarih aralığı
                <select value={exportDateRange} onChange={(e) => setExportDateRange(e.target.value)} className="mt-1 w-full rounded border border-border bg-zinc-900/70 px-2 py-2">
                  <option value="all">Tümü</option>
                  <option value="today">Bugün</option>
                  <option value="7d">Son 7 gün</option>
                  <option value="30d">Son 30 gün</option>
                  <option value="custom">Özel tarih</option>
                </select>
              </label>
              {exportDateRange === "custom" ? (
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={exportStartDate} onChange={(e) => setExportStartDate(e.target.value)} className="rounded border border-border bg-zinc-900/70 px-2 py-2 text-xs" />
                  <input type="date" value={exportEndDate} onChange={(e) => setExportEndDate(e.target.value)} className="rounded border border-border bg-zinc-900/70 px-2 py-2 text-xs" />
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setExportModalOpen(false)} className="rounded border border-border px-3 py-2 text-xs text-zinc-200">İptal</button>
              <button type="button" onClick={() => void runExport()} disabled={exportLoading} className="rounded border border-border px-3 py-2 text-xs text-zinc-100 disabled:opacity-50">
                {exportLoading ? "İndiriliyor..." : "İndir"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkRemoveModalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-[#0f1420] p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Baskılama Listesinden Toplu Çıkart</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <button type="button" onClick={() => setBulkRemoveMode("emails")} className={`rounded border px-2 py-2 text-xs ${bulkRemoveMode === "emails" ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>
                E-posta listesi yapıştır
              </button>
              <button type="button" onClick={() => setBulkRemoveMode("selected")} className={`rounded border px-2 py-2 text-xs ${bulkRemoveMode === "selected" ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>
                Seçili kayıtları çıkar
              </button>
              <button type="button" onClick={() => setBulkRemoveMode("filtered")} className={`rounded border px-2 py-2 text-xs ${bulkRemoveMode === "filtered" ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>
                Filtreye göre çıkar
              </button>
            </div>
            {bulkRemoveMode === "emails" ? (
              <div className="mt-3">
                <textarea
                  rows={6}
                  value={bulkRemoveText}
                  onChange={(e) => setBulkRemoveText(e.target.value)}
                  placeholder="Her satıra bir e-posta yazın."
                  className="w-full rounded border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                />
              </div>
            ) : null}
            <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={bulkRemoveConfirm} onChange={(e) => setBulkRemoveConfirm(e.target.checked)} />
              Eminim, bu e-postalar tekrar gönderilebilir hale gelebilir.
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setBulkRemoveModalOpen(false)} className="rounded border border-border px-3 py-2 text-xs text-zinc-200">İptal</button>
              <button type="button" onClick={() => void runBulkRemoveV2()} disabled={bulkRemoveLoading} className="rounded border border-rose-500/40 px-3 py-2 text-xs text-rose-200 disabled:opacity-50">
                {bulkRemoveLoading ? "Çıkartılıyor..." : "Toplu Çıkart"}
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
