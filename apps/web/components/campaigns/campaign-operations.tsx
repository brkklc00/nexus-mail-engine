"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  FileDown,
  Loader2,
  MailWarning,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Search,
  ShieldBan,
  SquareX,
  Trash2,
  TrendingUp,
  XCircle
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type CampaignStatus = "pending" | "queued" | "running" | "paused" | "completed" | "failed" | "canceled" | string;

type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  template: { id: string; title: string } | null;
  list: { id: string; name: string } | null;
  segment: { id: string; name: string } | null;
  smtp: { id: string; name: string } | null;
  targetedCount: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  openCount: number;
  clickCount: number;
  progress: number;
  createdAt: string;
  lastActivity: string | null;
};

type ListStats = {
  totalCampaigns: number;
  runningCampaigns: number;
  pausedCampaigns: number;
  completedCampaigns: number;
  canceledCampaigns: number;
  totalTargeted: number;
  totalSent: number;
  totalFailed: number;
  totalSkipped: number;
  totalOpened: number;
  totalClicked: number;
  averageDeliveryRate: number;
  queue: {
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
    retryWaiting: number;
    deadWaiting: number;
  };
};

type FilterOptions = {
  templates: Array<{ id: string; title: string }>;
  lists: Array<{ id: string; name: string }>;
  segments: Array<{ id: string; name: string }>;
  smtpAccounts: Array<{ id: string; name: string }>;
};

type CampaignListResponse = {
  items: CampaignRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: ListStats;
  filters: FilterOptions;
};

type CampaignDetailResponse = {
  campaign: {
    id: string;
    name: string;
    subject: string;
    status: string;
    provider: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    template: {
      id: string;
      title: string;
      subject: string;
      htmlBody: string;
      plainTextBody: string | null;
    } | null;
    list: { id: string; name: string } | null;
    segment: { id: string; name: string } | null;
    smtp: {
      id: string;
      name: string;
      host: string;
      port: number;
      fromEmail: string;
    } | null;
    metrics: {
      targeted: number;
      sent: number;
      failed: number;
      skipped: number;
      opened: number;
      clicked: number;
      unsubscribed: number;
      bounce: number;
      complaint: number;
      progress: number;
      totalClicks: number;
      uniqueClicks: number;
    };
    failureBreakdown: Array<{ eventType: string; count: number }>;
    skippedSummary: { skipped: number; suppressionMatched: number };
    topLinks: Array<{ id: string; url: string; clicks: number }>;
    recentLogs: Array<{ id: string; eventType: string; status: string; message: string | null; createdAt: string }>;
  };
};

type SummaryReport = {
  campaignId: string;
  name: string;
  status: string;
  totals: {
    targeted: number;
    sent: number;
    failed: number;
    skipped: number;
    opened: number;
    clicked: number;
    deliveryRate: number;
  };
};

const statusOptions = ["all", "pending", "queued", "running", "paused", "completed", "failed", "canceled"];
const rangeOptions = [
  { id: "all", label: "All time" },
  { id: "24h", label: "Last 24h" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "custom", label: "Custom" }
];

function fmtDate(input: string | null): string {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function toneForStatus(status: string): "success" | "danger" | "warning" | "info" | "muted" {
  if (status === "running" || status === "completed") return "success";
  if (status === "failed" || status === "canceled") return "danger";
  if (status === "paused" || status === "queued") return "warning";
  if (status === "pending") return "info";
  return "muted";
}

function availableActions(status: CampaignStatus): Array<"start" | "pause" | "resume" | "cancel" | "report" | "delete" | "view"> {
  if (status === "running") return ["pause", "cancel", "view", "report"];
  if (status === "paused") return ["resume", "cancel", "view", "report"];
  if (status === "pending" || status === "queued") return ["start", "cancel", "view"];
  if (status === "completed") return ["view", "report"];
  if (status === "canceled") return ["view", "delete"];
  if (status === "failed") return ["view", "report", "delete"];
  return ["view"];
}

export function CampaignOperations() {
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CampaignListResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [templateId, setTemplateId] = useState("all");
  const [listSegmentId, setListSegmentId] = useState("all");
  const [smtpAccountId, setSmtpAccountId] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [autoRefresh, setAutoRefresh] = useState<0 | 5 | 10>(0);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<CampaignDetailResponse["campaign"] | null>(null);
  const [reportSummary, setReportSummary] = useState<SummaryReport | null>(null);

  const listsAndSegments = useMemo(() => {
    if (!data) return [];
    return [
      ...data.filters.lists.map((item) => ({ id: item.id, label: `List: ${item.name}` })),
      ...data.filters.segments.map((item) => ({ id: item.id, label: `Segment: ${item.name}` }))
    ];
  }, [data]);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: `${page}`,
        pageSize: `${pageSize}`,
        search,
        status,
        range,
        from,
        to,
        templateId: templateId === "all" ? "" : templateId,
        listSegmentId: listSegmentId === "all" ? "" : listSegmentId,
        smtpAccountId: smtpAccountId === "all" ? "" : smtpAccountId
      });
      const response = await fetch(`/api/campaigns?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Campaign listesi yüklenemedi");
      }
      const payload = (await response.json()) as CampaignListResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaign listesi yüklenemedi");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, listSegmentId, page, pageSize, range, search, smtpAccountId, status, templateId, to]);

  const fetchCampaignDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setReportSummary(null);
    try {
      const response = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Campaign detayları alınamadı");
      }
      const payload = (await response.json()) as CampaignDetailResponse;
      setDetailData(payload.campaign);
      setDetailOpen(true);
    } catch (err) {
      toast.error("Campaign detayı açılamadı", err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const fetchReportSummary = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/campaigns/${id}/report?format=summary`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Rapor özeti alınamadı");
      }
      const payload = (await response.json()) as SummaryReport;
      setReportSummary(payload);
      toast.success("Rapor özeti hazır");
      if (!detailData || detailData.id !== id) {
        await fetchCampaignDetail(id);
      }
    } catch (err) {
      toast.error("Rapor özeti alınamadı", err instanceof Error ? err.message : "Beklenmeyen hata");
    }
  }, [detailData, fetchCampaignDetail, toast]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    if (autoRefresh === 0) return undefined;
    const timer = window.setInterval(() => {
      void fetchCampaigns();
    }, autoRefresh * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchCampaigns]);

  async function runAction(campaignId: string, action: "start" | "pause" | "resume" | "cancel" | "delete") {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Campaign iptal edilsin mi?",
        message: "Kampanya durdurulacak ve bekleyen gönderimler sonlanacak.",
        confirmLabel: "İptal et",
        cancelLabel: "Vazgeç",
        tone: "danger"
      });
      if (!ok) return;
    }
    if (action === "delete") {
      const ok = await confirm({
        title: "Campaign silinsin mi?",
        message: "Bu işlem geri alınamaz. Sadece güvenli statülerde silinebilir.",
        confirmLabel: "Sil",
        cancelLabel: "Vazgeç",
        tone: "danger"
      });
      if (!ok) return;
    }

    setPendingAction(`${campaignId}:${action}`);
    try {
      const endpoint = action === "delete" ? `/api/campaigns/${campaignId}` : `/api/campaigns/${campaignId}/${action}`;
      const method = action === "delete" ? "DELETE" : "POST";
      const response = await fetch(endpoint, { method });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `${action} başarısız`);
      }
      toast.success(`Campaign ${action} başarılı`);
      await fetchCampaigns();
      if (detailData?.id === campaignId) {
        await fetchCampaignDetail(campaignId);
      }
    } catch (err) {
      toast.error(`Campaign ${action} başarısız`, err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setPendingAction(null);
    }
  }

  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Total Campaigns" value={fmtInt(stats?.totalCampaigns ?? 0)} icon={BarChart3} />
        <StatCard title="Running" value={fmtInt(stats?.runningCampaigns ?? 0)} icon={Activity} tone="success" />
        <StatCard title="Paused" value={fmtInt(stats?.pausedCampaigns ?? 0)} icon={Pause} tone="warning" />
        <StatCard title="Completed" value={fmtInt(stats?.completedCampaigns ?? 0)} icon={CheckCircle2} tone="success" />
        <StatCard title="Canceled" value={fmtInt(stats?.canceledCampaigns ?? 0)} icon={XCircle} tone="danger" />
        <StatCard title="Avg Delivery Rate" value={`${stats?.averageDeliveryRate ?? 0}%`} icon={TrendingUp} />
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Targeted" value={fmtInt(stats?.totalTargeted ?? 0)} icon={MailWarning} />
        <StatCard title="Sent" value={fmtInt(stats?.totalSent ?? 0)} icon={CheckCircle2} tone="success" />
        <StatCard title="Failed" value={fmtInt(stats?.totalFailed ?? 0)} icon={XCircle} tone="danger" />
        <StatCard title="Skipped" value={fmtInt(stats?.totalSkipped ?? 0)} icon={ShieldBan} tone="warning" />
        <StatCard title="Opened" value={fmtInt(stats?.totalOpened ?? 0)} icon={Eye} />
        <StatCard title="Clicked" value={fmtInt(stats?.totalClicked ?? 0)} icon={Activity} />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-white">Live Queue Monitoring</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void fetchCampaigns()}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <select
              value={`${autoRefresh}`}
              onChange={(event) => setAutoRefresh(Number(event.target.value) as 0 | 5 | 10)}
              className="rounded-lg border border-border bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
            >
              <option value="0">Auto refresh: Off</option>
              <option value="5">Auto refresh: 5s</option>
              <option value="10">Auto refresh: 10s</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <QueuePill label="Waiting" value={stats?.queue.waiting ?? 0} />
          <QueuePill label="Active" value={stats?.queue.active ?? 0} />
          <QueuePill label="Failed" value={stats?.queue.failed ?? 0} />
          <QueuePill label="Delayed" value={stats?.queue.delayed ?? 0} />
          <QueuePill label="Retry Waiting" value={stats?.queue.retryWaiting ?? 0} />
          <QueuePill label="Dead Waiting" value={stats?.queue.deadWaiting ?? 0} />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search campaign..."
              className="w-full rounded-lg border border-border bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            {statusOptions.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "All status" : item}
              </option>
            ))}
          </select>
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="all">All templates</option>
            {data?.filters.templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <select
            value={listSegmentId}
            onChange={(event) => setListSegmentId(event.target.value)}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="all">All lists/segments</option>
            {listsAndSegments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={smtpAccountId}
            onChange={(event) => setSmtpAccountId(event.target.value)}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="all">All SMTPs</option>
            {data?.filters.smtpAccounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value)}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            {rangeOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            disabled={range !== "custom"}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            disabled={range !== "custom"}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-zinc-400">
            {data ? `${fmtInt(data.total)} campaigns` : "Campaign listesi"}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPage(1);
                void fetchCampaigns();
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setRange("all");
                setFrom("");
                setTo("");
                setTemplateId("all");
                setListSegmentId("all");
                setSmtpAccountId("all");
                setPage(1);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="p-6 text-sm text-zinc-300">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Campaign verileri yükleniyor...
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-300">{error}</div>
        ) : data && data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="megaphone"
              title="Campaign bulunamadı"
              description="Filtreyi temizleyip tekrar dene veya yeni campaign'i Send ekranından başlat."
            />
            <div className="mt-4 flex justify-center">
              <Link href="/send" className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900">
                Create and send campaign
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
                  <tr>
                    <th className="px-3 py-2">Campaign</th>
                    <th className="px-3 py-2">Template</th>
                    <th className="px-3 py-2">List/Segment</th>
                    <th className="px-3 py-2">SMTP</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Counts</th>
                    <th className="px-3 py-2">Open/Click</th>
                    <th className="px-3 py-2">Progress</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Last Activity</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((row) => {
                    const actions = availableActions(row.status);
                    return (
                      <tr
                        key={row.id}
                        className="cursor-pointer border-t border-border text-zinc-200 transition hover:bg-zinc-900/40"
                        onClick={() => void fetchCampaignDetail(row.id)}
                      >
                        <td className="px-3 py-2">
                          <p className="font-medium text-white">{row.name}</p>
                        </td>
                        <td className="px-3 py-2">{row.template?.title ?? "-"}</td>
                        <td className="px-3 py-2">{row.list?.name ?? row.segment?.name ?? "-"}</td>
                        <td className="px-3 py-2">{row.smtp?.name ?? "-"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge label={row.status} tone={toneForStatus(row.status)} />
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-300">
                          <p>T: {fmtInt(row.targetedCount)}</p>
                          <p>Q: {fmtInt(row.queuedCount)}</p>
                          <p>S: {fmtInt(row.sentCount)} F: {fmtInt(row.failedCount)} K: {fmtInt(row.skippedCount)}</p>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-300">
                          {fmtInt(row.openCount)} / {fmtInt(row.clickCount)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="w-28">
                            <div className="mb-1 h-2 rounded bg-zinc-800">
                              <div className="h-2 rounded bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, row.progress))}%` }} />
                            </div>
                            <p className="text-xs text-zinc-400">{row.progress}%</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-400">{fmtDate(row.createdAt)}</td>
                        <td className="px-3 py-2 text-xs text-zinc-400">{fmtDate(row.lastActivity)}</td>
                        <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                          <div className="flex flex-wrap gap-1">
                            {actions.includes("start") ? (
                              <ActionButton
                                label="Start"
                                icon={Rocket}
                                loading={pendingAction === `${row.id}:start`}
                                onClick={() => void runAction(row.id, "start")}
                              />
                            ) : null}
                            {actions.includes("pause") ? (
                              <ActionButton
                                label="Pause"
                                icon={Pause}
                                loading={pendingAction === `${row.id}:pause`}
                                onClick={() => void runAction(row.id, "pause")}
                              />
                            ) : null}
                            {actions.includes("resume") ? (
                              <ActionButton
                                label="Resume"
                                icon={Play}
                                loading={pendingAction === `${row.id}:resume`}
                                onClick={() => void runAction(row.id, "resume")}
                              />
                            ) : null}
                            {actions.includes("cancel") ? (
                              <ActionButton
                                label="Cancel"
                                icon={SquareX}
                                intent="danger"
                                loading={pendingAction === `${row.id}:cancel`}
                                onClick={() => void runAction(row.id, "cancel")}
                              />
                            ) : null}
                            {actions.includes("view") ? (
                              <ActionButton
                                label="View"
                                icon={Eye}
                                onClick={() => void fetchCampaignDetail(row.id)}
                              />
                            ) : null}
                            {actions.includes("report") ? (
                              <ActionButton
                                label="Report"
                                icon={FileDown}
                                onClick={() => void fetchReportSummary(row.id)}
                              />
                            ) : null}
                            {actions.includes("delete") ? (
                              <ActionButton
                                label="Delete"
                                icon={Trash2}
                                intent="danger"
                                loading={pendingAction === `${row.id}:delete`}
                                onClick={() => void runAction(row.id, "delete")}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-xs text-zinc-300">
              <div>
                Page {data?.page ?? 1} / {data?.totalPages ?? 1}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={`${pageSize}`}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  className="rounded border border-border bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={(data?.page ?? 1) <= 1}
                  className="rounded border border-border px-2 py-1 disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(data?.totalPages ?? 1, prev + 1))}
                  disabled={(data?.page ?? 1) >= (data?.totalPages ?? 1)}
                  className="rounded border border-border px-2 py-1 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {detailOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/55 p-4 backdrop-blur-sm" onClick={() => setDetailOpen(false)}>
          <div
            className="ml-auto h-full w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-zinc-950 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">{detailData?.name ?? "Campaign Detail"}</p>
                <p className="text-xs text-zinc-400">Campaign metadata, progress, failures, tracking ve logs</p>
              </div>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                onClick={() => setDetailOpen(false)}
              >
                Close
              </button>
            </div>

            {detailLoading ? (
              <p className="text-sm text-zinc-300">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Detail loading...
              </p>
            ) : !detailData ? (
              <p className="text-sm text-zinc-400">Campaign detay verisi bulunamadı.</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="grid gap-2 md:grid-cols-2">
                  <InfoCell label="Status" value={<StatusBadge label={detailData.status} tone={toneForStatus(detailData.status)} />} />
                  <InfoCell label="Provider" value={detailData.provider} />
                  <InfoCell label="Created" value={fmtDate(detailData.createdAt)} />
                  <InfoCell label="Started" value={fmtDate(detailData.startedAt)} />
                  <InfoCell label="Finished" value={fmtDate(detailData.finishedAt)} />
                  <InfoCell label="Subject" value={detailData.subject || "-"} />
                  <InfoCell label="Template" value={detailData.template?.title ?? "-"} />
                  <InfoCell label="List/Segment" value={detailData.list?.name ?? detailData.segment?.name ?? "-"} />
                  <InfoCell label="SMTP" value={detailData.smtp?.name ?? "-"} />
                  <InfoCell
                    label="SMTP Host"
                    value={detailData.smtp ? `${detailData.smtp.host}:${detailData.smtp.port} (${detailData.smtp.fromEmail})` : "-"}
                  />
                </div>

                <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Delivery Progress</p>
                  <div className="mb-2 h-2 rounded bg-zinc-800">
                    <div className="h-2 rounded bg-indigo-500" style={{ width: `${detailData.metrics.progress}%` }} />
                  </div>
                  <p className="text-xs text-zinc-300">{detailData.metrics.progress}% completed</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Metric label="Targeted" value={detailData.metrics.targeted} />
                    <Metric label="Sent" value={detailData.metrics.sent} />
                    <Metric label="Failed" value={detailData.metrics.failed} />
                    <Metric label="Skipped" value={detailData.metrics.skipped} />
                    <Metric label="Opened" value={detailData.metrics.opened} />
                    <Metric label="Clicked" value={detailData.metrics.clicked} />
                    <Metric label="Total Clicks" value={detailData.metrics.totalClicks} />
                    <Metric label="Unique Clicks" value={detailData.metrics.uniqueClicks} />
                    <Metric label="Unsubs" value={detailData.metrics.unsubscribed} />
                    <Metric label="Bounce" value={detailData.metrics.bounce} />
                    <Metric label="Complaint" value={detailData.metrics.complaint} />
                    <Metric label="Suppression Skip" value={detailData.skippedSummary.suppressionMatched} />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Failure Breakdown</p>
                  {detailData.failureBreakdown.length === 0 ? (
                    <p className="text-xs text-zinc-400">Failure breakdown bulunamadı.</p>
                  ) : (
                    <div className="space-y-1">
                      {detailData.failureBreakdown.map((item) => (
                        <div key={item.eventType} className="flex items-center justify-between rounded bg-zinc-950/60 px-2 py-1 text-xs">
                          <span className="text-zinc-300">{item.eventType}</span>
                          <span className="text-rose-300">{fmtInt(item.count)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Top Clicked Links</p>
                  {detailData.topLinks.length === 0 ? (
                    <p className="text-xs text-zinc-400">Click verisi bulunamadı.</p>
                  ) : (
                    <div className="space-y-1">
                      {detailData.topLinks.map((item) => (
                        <div key={item.id} className="rounded bg-zinc-950/60 px-2 py-1 text-xs">
                          <p className="truncate text-zinc-300">{item.url}</p>
                          <p className="text-zinc-500">{fmtInt(item.clicks)} clicks</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Report & Export</p>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                      onClick={() => void fetchReportSummary(detailData.id)}
                    >
                      Refresh Summary
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => window.open(`/api/campaigns/${detailData.id}/report?format=failed`, "_blank")}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                    >
                      Export Failed CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(`/api/campaigns/${detailData.id}/report?format=skipped`, "_blank")}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                    >
                      Export Skipped CSV
                    </button>
                  </div>
                  {reportSummary ? (
                    <div className="mt-2 rounded bg-zinc-950/60 p-2 text-xs text-zinc-300">
                      Delivery rate: {reportSummary.totals.deliveryRate}% · Targeted: {fmtInt(reportSummary.totals.targeted)} ·
                      Sent: {fmtInt(reportSummary.totals.sent)} · Failed: {fmtInt(reportSummary.totals.failed)} · Skipped:{" "}
                      {fmtInt(reportSummary.totals.skipped)}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Recent Campaign Logs</p>
                  <div className="max-h-64 space-y-1 overflow-y-auto text-xs">
                    {detailData.recentLogs.length === 0 ? (
                      <p className="text-zinc-500">Log bulunamadı.</p>
                    ) : (
                      detailData.recentLogs.map((log) => (
                        <div key={log.id} className="rounded bg-zinc-950/60 px-2 py-1">
                          <p className="text-zinc-300">
                            [{fmtDate(log.createdAt)}] {log.eventType} · {log.status}
                          </p>
                          <p className="truncate text-zinc-500">{log.message ?? "-"}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {detailData.template ? (
                  <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Template Preview</p>
                    <div className="h-64 overflow-hidden rounded border border-border bg-white">
                      <iframe
                        title="campaign-template-preview"
                        className="h-full w-full"
                        sandbox="allow-same-origin"
                        srcDoc={detailData.template.htmlBody}
                      />
                    </div>
                    {detailData.template.plainTextBody ? (
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-zinc-950/60 p-2 text-xs text-zinc-300">
                        {detailData.template.plainTextBody}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone = "default"
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      : tone === "warning"
        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
        : tone === "danger"
          ? "text-rose-300 border-rose-500/30 bg-rose-500/10"
          : "text-zinc-200 border-border bg-zinc-900/50";
  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide">{title}</p>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}

function QueuePill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-zinc-900/50 px-3 py-2">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-100">{fmtInt(value)}</p>
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  loading,
  onClick,
  intent = "default"
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  onClick: () => void;
  intent?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-50 ${
        intent === "danger" ? "border-rose-500/50 text-rose-300 hover:bg-rose-500/10" : "border-border text-zinc-200 hover:bg-zinc-900"
      }`}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-zinc-950/60 px-2 py-1">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{fmtInt(value)}</p>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-zinc-900/40 p-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <div className="mt-1 text-sm text-zinc-200">{value}</div>
    </div>
  );
}
