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

function getCampaignStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Bekliyor",
    queued: "Kuyrukta",
    running: "Calisiyor",
    paused: "Duraklatildi",
    completed: "Tamamlandi",
    partially_completed: "Kismen Tamamlandi",
    failed: "Basarisiz",
    canceled: "Iptal Edildi"
  };
  return map[status] ?? status;
}

function availableActions(status: CampaignStatus): Array<"start" | "pause" | "resume" | "cancel" | "report" | "delete" | "view"> {
  if (status === "running") return ["pause", "cancel", "view", "report", "delete"];
  if (status === "paused") return ["resume", "cancel", "view", "report"];
  if (status === "pending") return ["start", "cancel", "view"];
  if (status === "queued") return ["start", "cancel", "view", "delete"];
  if (status === "completed" || status === "partially_completed") return ["view", "report", "delete"];
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; status: CampaignStatus } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

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
        throw new Error(payload.error ?? "Kampanya listesi yuklenemedi");
      }
      const payload = (await response.json()) as CampaignListResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kampanya listesi yuklenemedi");
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
        throw new Error(payload.error ?? "Kampanya detaylari yuklenemedi");
      }
      const payload = (await response.json()) as CampaignDetailResponse;
      setDetailData(payload.campaign);
      setDetailOpen(true);
    } catch (err) {
      toast.error("Kampanya detaylari acilamadi", err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const fetchReportSummary = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/campaigns/${id}/report?format=summary`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Rapor ozeti yuklenemedi");
      }
      const payload = (await response.json()) as SummaryReport;
      setReportSummary(payload);
      toast.success("Rapor ozeti hazir");
      if (!detailData || detailData.id !== id) {
        await fetchCampaignDetail(id);
      }
    } catch (err) {
      toast.error("Rapor ozeti yuklenemedi", err instanceof Error ? err.message : "Beklenmeyen hata");
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

  async function runAction(
    campaignId: string,
    action: "start" | "pause" | "resume" | "cancel" | "delete",
    campaignStatus?: CampaignStatus,
    campaignName?: string,
    forceDelete = false
  ) {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Campaign iptal edilsin mi?",
        message: "Campaign will be stopped and pending sends will be terminated.",
        confirmLabel: "Stop campaign",
        cancelLabel: "Vazgec",
        tone: "danger"
      });
      if (!ok) return;
    }
    if (action === "delete" && !forceDelete) {
      if (campaignStatus === "running" || campaignStatus === "queued") {
        toast.warning("Running campaigns must be canceled before deletion.");
        return;
      }
      setDeleteTarget({
        id: campaignId,
        name: campaignName ?? campaignId,
        status: campaignStatus ?? "unknown"
      });
      setDeleteConfirmText("");
      setDeleteDialogOpen(true);
      return;
    }

    setPendingAction(`${campaignId}:${action}`);
    try {
      const endpoint = action === "delete" ? `/api/campaigns/${campaignId}` : `/api/campaigns/${campaignId}/${action}`;
      const method = action === "delete" ? "DELETE" : "POST";
      const response = await fetch(endpoint, { method });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        recipientCleanup?: "running" | "completed";
      };
      if (!response.ok) {
        if (payload.error && /campaign_must_be_canceled_first/i.test(payload.error)) {
          throw new Error("Running campaigns must be canceled before deletion.");
        }
        throw new Error(payload.error ?? `${action} failed`);
      }
      if (action === "cancel") {
        toast.info("Campaign canceled. Pending recipients will stop processing.");
      } else if (action === "delete") {
        toast.success("Kampanya basariyla silindi.");
        if (detailData?.id === campaignId) {
          setDetailOpen(false);
          setDetailData(null);
        }
      } else {
        toast.success(`Kampanya islemi basarili: ${action}`);
      }
      await fetchCampaigns();
      if (action !== "delete" && detailData?.id === campaignId) {
        await fetchCampaignDetail(campaignId);
      }
    } catch (err) {
      toast.error(`Kampanya islemi basarisiz: ${action}`, err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setPendingAction(null);
    }
  }

  const stats = data?.stats;
  const deleteReady = deleteConfirmText.trim().toUpperCase() === "DELETE";

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Toplam Kampanya" value={fmtInt(stats?.totalCampaigns ?? 0)} icon={BarChart3} />
        <StatCard title="Calisiyor" value={fmtInt(stats?.runningCampaigns ?? 0)} icon={Activity} tone="success" />
        <StatCard title="Duraklatildi" value={fmtInt(stats?.pausedCampaigns ?? 0)} icon={Pause} tone="warning" />
        <StatCard title="Tamamlandi" value={fmtInt(stats?.completedCampaigns ?? 0)} icon={CheckCircle2} tone="success" />
        <StatCard title="Iptal Edildi" value={fmtInt(stats?.canceledCampaigns ?? 0)} icon={XCircle} tone="danger" />
        <StatCard title="Ort. Teslimat Orani" value={`${stats?.averageDeliveryRate ?? 0}%`} icon={TrendingUp} />
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Hedeflenen" value={fmtInt(stats?.totalTargeted ?? 0)} icon={MailWarning} />
        <StatCard title="Gonderildi" value={fmtInt(stats?.totalSent ?? 0)} icon={CheckCircle2} tone="success" />
        <StatCard title="Basarisiz" value={fmtInt(stats?.totalFailed ?? 0)} icon={XCircle} tone="danger" />
        <StatCard title="Atlandi" value={fmtInt(stats?.totalSkipped ?? 0)} icon={ShieldBan} tone="warning" />
        <StatCard title="Acilma" value={fmtInt(stats?.totalOpened ?? 0)} icon={Eye} />
        <StatCard title="Tiklama" value={fmtInt(stats?.totalClicked ?? 0)} icon={Activity} />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-white">Canli Kuyruk Izleme</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void fetchCampaigns()}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Yenile
            </button>
            <select
              value={`${autoRefresh}`}
              onChange={(event) => setAutoRefresh(Number(event.target.value) as 0 | 5 | 10)}
              className="rounded-lg border border-border bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
            >
              <option value="0">Otomatik yenileme: Kapali</option>
              <option value="5">Otomatik yenileme: 5sn</option>
              <option value="10">Otomatik yenileme: 10sn</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <QueuePill label="Bekleyen" value={stats?.queue.waiting ?? 0} />
          <QueuePill label="Aktif" value={stats?.queue.active ?? 0} />
          <QueuePill label="Basarisiz" value={stats?.queue.failed ?? 0} />
          <QueuePill label="Gecikmeli" value={stats?.queue.delayed ?? 0} />
          <QueuePill label="Retry Bekleyen" value={stats?.queue.retryWaiting ?? 0} />
          <QueuePill label="Dead Bekleyen" value={stats?.queue.deadWaiting ?? 0} />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Kampanya ara..."
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
                {item === "all" ? "Tum durumlar" : getCampaignStatusLabel(item)}
              </option>
            ))}
          </select>
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="all">Tum sablonlar</option>
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
            <option value="all">Tum listeler/segmentler</option>
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
            <option value="all">Tum SMTP'ler</option>
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
            {data ? `${fmtInt(data.total)} kampanya` : "Kampanya listesi"}
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
              Filtreleri Uygula
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
              Sifirla
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="p-6 text-sm text-zinc-300">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Kampanya verileri yukleniyor...
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-300">{error}</div>
        ) : data && data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="megaphone"
              title="Kampanya bulunamadi"
              description="Filtreleri temizleyip tekrar deneyin veya Gonderim Kontrolu panelinden yeni kampanya baslatin."
            />
            <div className="mt-4 flex justify-center">
              <Link href="/send" className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900">
                Kampanya olustur ve gonder
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
                  <tr>
                    <th className="px-3 py-2">Kampanya</th>
                    <th className="px-3 py-2">Sablon</th>
                    <th className="px-3 py-2">List/Segment</th>
                    <th className="px-3 py-2">SMTP</th>
                    <th className="px-3 py-2">Durum</th>
                    <th className="px-3 py-2">Sayilar</th>
                    <th className="px-3 py-2">Acilma/Tiklama</th>
                    <th className="px-3 py-2">Ilerleme</th>
                    <th className="px-3 py-2">Olusturma</th>
                    <th className="px-3 py-2">Son Aktivite</th>
                    <th className="px-3 py-2">Islemler</th>
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
                          <StatusBadge label={getCampaignStatusLabel(row.status)} tone={toneForStatus(row.status)} />
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
                                label="Baslat"
                                icon={Rocket}
                                loading={pendingAction === `${row.id}:start`}
                                onClick={() => void runAction(row.id, "start")}
                              />
                            ) : null}
                            {actions.includes("pause") ? (
                              <ActionButton
                                label="Duraklat"
                                icon={Pause}
                                loading={pendingAction === `${row.id}:pause`}
                                onClick={() => void runAction(row.id, "pause")}
                              />
                            ) : null}
                            {actions.includes("resume") ? (
                              <ActionButton
                                label="Devam Et"
                                icon={Play}
                                loading={pendingAction === `${row.id}:resume`}
                                onClick={() => void runAction(row.id, "resume")}
                              />
                            ) : null}
                            {actions.includes("cancel") ? (
                              <ActionButton
                                label="Iptal Et"
                                icon={SquareX}
                                intent="danger"
                                loading={pendingAction === `${row.id}:cancel`}
                                onClick={() => void runAction(row.id, "cancel")}
                              />
                            ) : null}
                            {actions.includes("view") ? (
                              <ActionButton
                                label="Goruntule"
                                icon={Eye}
                                onClick={() => void fetchCampaignDetail(row.id)}
                              />
                            ) : null}
                            {actions.includes("report") ? (
                              <ActionButton
                                label="Rapor"
                                icon={FileDown}
                                onClick={() => void fetchReportSummary(row.id)}
                              />
                            ) : null}
                            {actions.includes("delete") ? (
                              <ActionButton
                                label="Sil"
                                icon={Trash2}
                                intent="danger"
                                loading={pendingAction === `${row.id}:delete`}
                                onClick={() => void runAction(row.id, "delete", row.status, row.name)}
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
                Sayfa {data?.page ?? 1} / {data?.totalPages ?? 1}
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
                  Onceki
                </button>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(data?.totalPages ?? 1, prev + 1))}
                  disabled={(data?.page ?? 1) >= (data?.totalPages ?? 1)}
                  className="rounded border border-border px-2 py-1 disabled:opacity-50"
                >
                  Sonraki
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
                <p className="text-xs text-zinc-400">Kampanya metadata, ilerleme, basarisizlik, takip ve log kayitlari</p>
              </div>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                onClick={() => setDetailOpen(false)}
              >
                Kapat
              </button>
            </div>

            {detailLoading ? (
              <p className="text-sm text-zinc-300">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Detail loading...
              </p>
            ) : !detailData ? (
              <p className="text-sm text-zinc-400">Kampanya detay verisi bulunamadi.</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="grid gap-2 md:grid-cols-2">
                  <InfoCell label="Durum" value={<StatusBadge label={getCampaignStatusLabel(detailData.status)} tone={toneForStatus(detailData.status)} />} />
                  <InfoCell label="Saglayici" value={detailData.provider} />
                  <InfoCell label="Olusturma" value={fmtDate(detailData.createdAt)} />
                  <InfoCell label="Baslangic" value={fmtDate(detailData.startedAt)} />
                  <InfoCell label="Bitis" value={fmtDate(detailData.finishedAt)} />
                  <InfoCell label="Konu" value={detailData.subject || "-"} />
                  <InfoCell label="Sablon" value={detailData.template?.title ?? "-"} />
                  <InfoCell label="Liste/Segment" value={detailData.list?.name ?? detailData.segment?.name ?? "-"} />
                  <InfoCell label="SMTP" value={detailData.smtp?.name ?? "-"} />
                  <InfoCell
                    label="SMTP Host"
                    value={detailData.smtp ? `${detailData.smtp.host}:${detailData.smtp.port} (${detailData.smtp.fromEmail})` : "-"}
                  />
                </div>

                <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Teslimat Ilerlemesi</p>
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
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Basarisizlik Dagilimi</p>
                  {detailData.failureBreakdown.length === 0 ? (
                    <p className="text-xs text-zinc-400">Failure breakdown not found.</p>
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
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">En Cok Tiklanan Linkler</p>
                  {detailData.topLinks.length === 0 ? (
                    <p className="text-xs text-zinc-400">Click data not found.</p>
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
                    <p className="text-xs uppercase tracking-wide text-zinc-400">Rapor ve Disa Aktarma</p>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                      onClick={() => void fetchReportSummary(detailData.id)}
                    >
                      Ozeti Yenile
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => window.open(`/api/campaigns/${detailData.id}/report?format=failed`, "_blank")}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                    >
                      Basarisiz CSV Disa Aktar
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(`/api/campaigns/${detailData.id}/report?format=skipped`, "_blank")}
                      className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                    >
                      Atlanan CSV Disa Aktar
                    </button>
                  </div>
                  {reportSummary ? (
                    <div className="mt-2 rounded bg-zinc-950/60 p-2 text-xs text-zinc-300">
                      Teslimat orani: {reportSummary.totals.deliveryRate}% · Hedeflenen: {fmtInt(reportSummary.totals.targeted)} ·
                      Gonderilen: {fmtInt(reportSummary.totals.sent)} · Basarisiz: {fmtInt(reportSummary.totals.failed)} · Atlanan:{" "}
                      {fmtInt(reportSummary.totals.skipped)}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-border bg-zinc-900/50 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Son Kampanya Kayitlari</p>
                  <div className="max-h-64 space-y-1 overflow-y-auto text-xs">
                    {detailData.recentLogs.length === 0 ? (
                      <p className="text-zinc-500">Kayit bulunamadi.</p>
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
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Sablon Onizleme</p>
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

      {deleteDialogOpen && deleteTarget ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-zinc-950 p-4">
            <p className="text-base font-semibold text-white">Kampanya silinsin mi?</p>
            <p className="mt-2 text-sm text-zinc-300">
              Bu islem kampanyayi listeden kaldirir. Teslimat kayitlari ve raporlar korunur.
            </p>
            <p className="mt-2 text-xs text-zinc-500">Campaign: {deleteTarget.name}</p>
            <div className="mt-3">
              <label className="text-xs text-zinc-400">Onaylamak icin DELETE yazin</label>
              <input
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-rose-400"
                placeholder="DELETE"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setDeleteTarget(null);
                  setDeleteConfirmText("");
                }}
                className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                Iptal
              </button>
              <button
                type="button"
                disabled={!deleteReady || pendingAction === `${deleteTarget.id}:delete`}
                onClick={async () => {
                  const targetId = deleteTarget.id;
                  setDeleteDialogOpen(false);
                  await runAction(targetId, "delete", deleteTarget.status, deleteTarget.name, true);
                  setDeleteTarget(null);
                  setDeleteConfirmText("");
                }}
                className="rounded-lg border border-rose-500/60 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === `${deleteTarget.id}:delete` ? "Siliniyor..." : "Kampanyayi sil"}
              </button>
            </div>
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
