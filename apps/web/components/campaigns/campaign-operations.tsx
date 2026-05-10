"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { CampaignDashboardHeader } from "./dashboard/campaign-dashboard-header";
import { CampaignDashboardTable } from "./dashboard/campaign-dashboard-table";
import { CampaignFiltersBar } from "./dashboard/campaign-filters-bar";
import { CampaignMetricCards } from "./dashboard/campaign-metric-cards";
import { CampaignQueueMonitor } from "./dashboard/campaign-queue-monitor";
import { CampaignStatusBadge } from "./dashboard/campaign-status-badge";
import type {
  CampaignListResponse,
  CampaignStatus,
  ListStats,
  QueueAdminAction,
  QueueAdminResponse
} from "./dashboard/campaign-dashboard-types";
import { fmtDate, fmtInt, getCampaignStatusLabel } from "./dashboard/campaign-dashboard-utils";
import { campaignTheme } from "./dashboard/campaign-theme";

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

export function CampaignOperations() {
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statsWarning, setStatsWarning] = useState<string | null>(null);
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
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<CampaignDetailResponse["campaign"] | null>(null);
  const [reportSummary, setReportSummary] = useState<SummaryReport | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; status: CampaignStatus } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [queueActionLoading, setQueueActionLoading] = useState<QueueAdminAction | null>(null);
  const [queueSummary, setQueueSummary] = useState<QueueAdminResponse | null>(null);
  const [queueConfirmAction, setQueueConfirmAction] = useState<QueueAdminAction | null>(null);
  const [queueConfirmText, setQueueConfirmText] = useState("");
  const [queueSectionWarning, setQueueSectionWarning] = useState<string | null>(null);

  const listsAndSegments = useMemo(() => {
    if (!data) return [];
    return [
      ...data.filters.lists.map((item) => ({ id: item.id, label: `Liste: ${item.name}` })),
      ...data.filters.segments.map((item) => ({ id: item.id, label: `Segment: ${item.name}` }))
    ];
  }, [data]);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setListError(null);
    setStatsWarning(null);
    setQueueSectionWarning(null);
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
      const payload = (await response.json().catch(() => ({}))) as CampaignListResponse;
      if (!response.ok || payload.ok === false) {
        if (payload.code === "campaign_list_failed") {
          throw new Error("Kampanya listesi yüklenemedi");
        }
        throw new Error(payload.error ?? "Kampanya listesi yüklenemedi");
      }
      if (!payload.stats && Array.isArray(payload.items)) {
        setStatsWarning("Özet metrikler şu anda alınamadı.");
      }
      if (payload.stats && typeof payload.stats.queue !== "object") {
        setQueueSectionWarning("Kuyruk metrikleri şu anda alınamadı.");
      }
      setData(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Kampanya listesi yüklenemedi";
      setListError(msg);
      console.error("[campaigns] list fetch", err);
    } finally {
      setLoading(false);
    }
  }, [from, listSegmentId, page, pageSize, range, search, smtpAccountId, status, templateId, to]);

  const fetchCampaignDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setReportSummary(null);
      try {
        const response = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as CampaignDetailResponse | { error?: string };
        if (!response.ok || !("campaign" in payload)) {
          throw new Error((payload as { error?: string }).error ?? "Kampanya detayları yüklenemedi");
        }
        setDetailData(payload.campaign);
        setDetailOpen(true);
      } catch (err) {
        toast.error("Kampanya detayları açılamadı", err instanceof Error ? err.message : "Beklenmeyen hata");
        console.error("[campaigns] detail", err);
      } finally {
        setDetailLoading(false);
      }
    },
    [toast]
  );

  const fetchReportSummary = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/campaigns/${id}/report?format=summary`, { cache: "no-store" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Rapor özeti yüklenemedi");
        }
        const payload = (await response.json()) as SummaryReport;
        setReportSummary(payload);
        toast.success("Rapor özeti hazır");
        if (!detailData || detailData.id !== id) {
          await fetchCampaignDetail(id);
        }
      } catch (err) {
        toast.error("Rapor özeti yüklenemedi", err instanceof Error ? err.message : "Beklenmeyen hata");
        console.error("[campaigns] report summary", err);
      }
    },
    [detailData, fetchCampaignDetail, toast]
  );

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
        title: "Kampanya iptal edilsin mi?",
        message: "Kampanya durdurulacak ve bekleyen gönderimler sonlandırılacak.",
        confirmLabel: "İptal et",
        cancelLabel: "Vazgeç",
        tone: "danger"
      });
      if (!ok) return;
    }
    if (action === "delete" && !forceDelete) {
      if (campaignStatus === "running" || campaignStatus === "queued") {
        toast.warning("Çalışan kampanyalar silinmeden önce iptal edilmelidir.");
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
          throw new Error("Çalışan kampanyalar silinmeden önce iptal edilmelidir.");
        }
        throw new Error(payload.error ?? `${action} failed`);
      }
      if (action === "cancel") {
        toast.info("Kampanya iptal edildi. Bekleyen alıcılar işlenmeyecek.");
      } else if (action === "delete") {
        toast.success("Kampanya silindi.");
        if (detailData?.id === campaignId) {
          setDetailOpen(false);
          setDetailData(null);
        }
      } else {
        toast.success(`İşlem tamamlandı: ${action}`);
      }
      await fetchCampaigns();
      if (action !== "delete" && detailData?.id === campaignId) {
        await fetchCampaignDetail(campaignId);
      }
    } catch (err) {
      toast.error(`İşlem başarısız: ${action}`, err instanceof Error ? err.message : "Beklenmeyen hata");
      console.error("[campaigns] action", action, err);
    } finally {
      setPendingAction(null);
    }
  }

  const stats = data?.stats;
  const deleteReady = deleteConfirmText.trim().toUpperCase() === "DELETE";
  const campaignItems = useMemo(() => data?.items ?? [], [data?.items]);

  const applyFilters = useCallback(() => {
    setPage(1);
    void fetchCampaigns();
  }, [fetchCampaigns]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setStatus("all");
    setRange("all");
    setFrom("");
    setTo("");
    setTemplateId("all");
    setListSegmentId("all");
    setSmtpAccountId("all");
    setPage(1);
  }, []);

  async function runQueueAction(action: QueueAdminAction) {
    setQueueActionLoading(action);
    try {
      const response = await fetch("/api/queue/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = (await response.json().catch(() => ({}))) as QueueAdminResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Kuyruk işlemi başarısız");
      }
      setQueueSummary(payload);
      toast.success(
        "Kuyruk işlemi tamamlandı",
        `Taranan: ${payload.scanned ?? 0} · Temizlenen: ${payload.cleaned ?? 0} · Korunan aktif: ${payload.skippedActive ?? 0}`
      );
      setQueueConfirmAction(null);
      setQueueConfirmText("");
      await fetchCampaigns();
    } catch (err) {
      toast.error("Kuyruk işlemi başarısız", err instanceof Error ? err.message : "Beklenmeyen hata");
      console.error("[campaigns] queue admin", err);
    } finally {
      setQueueActionLoading(null);
    }
  }

  function requestQueueAction(action: QueueAdminAction) {
    if (action === "clean_stale_campaign_jobs" || action === "clean_failed" || action === "clean_completed") {
      setQueueConfirmAction(action);
      setQueueConfirmText("");
      return;
    }
    void runQueueAction(action);
  }

  const isCleanupRunning =
    queueActionLoading === "clean_stale_campaign_jobs" ||
    queueActionLoading === "clean_failed" ||
    queueActionLoading === "clean_completed";

  const statsSafe: ListStats | undefined = stats ?? undefined;

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 px-4 pb-10 pt-6 text-zinc-200">
      <CampaignDashboardHeader />

      <CampaignMetricCards stats={statsSafe} statsWarning={statsWarning} />

      <CampaignQueueMonitor
        stats={statsSafe}
        queueSummary={queueSummary}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => void fetchCampaigns()}
        onQueueAction={requestQueueAction}
        queueActionLoading={queueActionLoading}
        queueWarning={queueSectionWarning}
      />

      <CampaignFiltersBar
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
        templateId={templateId}
        onTemplateIdChange={setTemplateId}
        listSegmentId={listSegmentId}
        onListSegmentIdChange={setListSegmentId}
        smtpAccountId={smtpAccountId}
        onSmtpAccountIdChange={setSmtpAccountId}
        listsAndSegments={listsAndSegments}
        filters={data?.filters}
        range={range}
        onRangeChange={setRange}
        from={from}
        onFromChange={setFrom}
        to={to}
        onToChange={setTo}
        advancedFiltersOpen={advancedFiltersOpen}
        onToggleAdvanced={() => setAdvancedFiltersOpen((o) => !o)}
        onApply={applyFilters}
        onReset={resetFilters}
        getStatusLabel={getCampaignStatusLabel}
      />

      <CampaignDashboardTable
        loading={loading}
        listError={listError}
        items={campaignItems}
        total={data?.total ?? 0}
        page={data?.page ?? page}
        totalPages={data?.totalPages ?? 1}
        pageSize={pageSize}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        pendingAction={pendingAction}
        onRowClick={(id) => void fetchCampaignDetail(id)}
        onView={(id) => void fetchCampaignDetail(id)}
        onReport={(id) => void fetchReportSummary(id)}
        onAction={(id, action, row) => void runAction(id, action, row.status, row.name)}
      />

      {detailOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/55 p-4 backdrop-blur-sm" onClick={() => setDetailOpen(false)}>
          <div
            className={`ml-auto h-full w-full max-w-3xl overflow-y-auto rounded-2xl border ${campaignTheme.border} bg-[#121722] p-5 shadow-2xl shadow-black/50 ring-1 ring-indigo-500/10`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">{detailData?.name ?? "Kampanya detayı"}</p>
                <p className="text-xs text-zinc-500">İlerleme, başarısızlık, takip ve günlük kayıtları</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
                onClick={() => setDetailOpen(false)}
              >
                Kapat
              </button>
            </div>

            {detailLoading ? (
              <p className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Yükleniyor…
              </p>
            ) : !detailData ? (
              <p className="text-sm text-zinc-500">Detay bulunamadı.</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="grid gap-2 md:grid-cols-2">
                  <InfoCell
                    label="Durum"
                    value={<CampaignStatusBadge status={detailData.status} />}
                  />
                  <InfoCell label="Sağlayıcı" value={detailData.provider} />
                  <InfoCell label="Oluşturma" value={fmtDate(detailData.createdAt)} />
                  <InfoCell label="Başlangıç" value={fmtDate(detailData.startedAt)} />
                  <InfoCell label="Bitiş" value={fmtDate(detailData.finishedAt)} />
                  <InfoCell label="Konu" value={detailData.subject || "—"} />
                  <InfoCell label="Şablon" value={detailData.template?.title ?? "—"} />
                  <InfoCell label="Liste/Segment" value={detailData.list?.name ?? detailData.segment?.name ?? "—"} />
                  <InfoCell label="SMTP" value={detailData.smtp?.name ?? "—"} />
                  <InfoCell
                    label="SMTP host"
                    value={detailData.smtp ? `${detailData.smtp.host}:${detailData.smtp.port} (${detailData.smtp.fromEmail})` : "—"}
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Teslimat ilerlemesi</p>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                      style={{ width: `${detailData.metrics.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-400">{detailData.metrics.progress}% tamamlandı</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Metric label="Hedeflenen" value={detailData.metrics.targeted} />
                    <Metric label="Gönderilen" value={detailData.metrics.sent} />
                    <Metric label="Başarısız" value={detailData.metrics.failed} />
                    <Metric label="Atlanan" value={detailData.metrics.skipped} />
                    <Metric label="Açılma" value={detailData.metrics.opened} />
                    <Metric label="Tıklama" value={detailData.metrics.clicked} />
                    <Metric label="Toplam tıklama" value={detailData.metrics.totalClicks} />
                    <Metric label="Benzersiz tıklama" value={detailData.metrics.uniqueClicks} />
                    <Metric label="Çıkış" value={detailData.metrics.unsubscribed} />
                    <Metric label="Bounce" value={detailData.metrics.bounce} />
                    <Metric label="Şikayet" value={detailData.metrics.complaint} />
                    <Metric label="Baskılama eşleşmesi" value={detailData.skippedSummary.suppressionMatched} />
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Başarısızlık dağılımı</p>
                  {detailData.failureBreakdown.length === 0 ? (
                    <p className="text-xs text-zinc-500">Kayıt yok.</p>
                  ) : (
                    <div className="space-y-1">
                      {detailData.failureBreakdown.map((item) => (
                        <div key={item.eventType} className="flex items-center justify-between rounded-lg bg-zinc-950/60 px-2 py-1.5 text-xs">
                          <span className="text-zinc-300">{item.eventType}</span>
                          <span className="text-rose-300">{fmtInt(item.count)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">En çok tıklanan bağlantılar</p>
                  {detailData.topLinks.length === 0 ? (
                    <p className="text-xs text-zinc-500">Veri yok.</p>
                  ) : (
                    <div className="space-y-1">
                      {detailData.topLinks.map((item) => (
                        <div key={item.id} className="rounded-lg bg-zinc-950/60 px-2 py-1.5 text-xs">
                          <p className="truncate text-zinc-300">{item.url}</p>
                          <p className="text-zinc-500">{fmtInt(item.clicks)} tıklama</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Rapor</p>
                    <button
                      type="button"
                      className="rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                      onClick={() => void fetchReportSummary(detailData.id)}
                    >
                      Özeti yenile
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => window.open(`/api/campaigns/${detailData.id}/report?format=failed`, "_blank")}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                    >
                      Başarısız CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(`/api/campaigns/${detailData.id}/report?format=skipped`, "_blank")}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                    >
                      Atlanan CSV
                    </button>
                  </div>
                  {reportSummary ? (
                    <div className="mt-2 rounded-lg bg-zinc-950/60 p-2 text-xs text-zinc-300">
                      Teslimat oranı: {reportSummary.totals.deliveryRate}% · Hedeflenen: {fmtInt(reportSummary.totals.targeted)} · Gönderilen:{" "}
                      {fmtInt(reportSummary.totals.sent)} · Başarısız: {fmtInt(reportSummary.totals.failed)} · Atlanan:{" "}
                      {fmtInt(reportSummary.totals.skipped)}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Son günlük kayıtları</p>
                  <div className="max-h-64 space-y-1 overflow-y-auto text-xs">
                    {detailData.recentLogs.length === 0 ? (
                      <p className="text-zinc-500">Kayıt yok.</p>
                    ) : (
                      detailData.recentLogs.map((log) => (
                        <div key={log.id} className="rounded-lg bg-zinc-950/60 px-2 py-1.5">
                          <p className="text-zinc-300">
                            [{fmtDate(log.createdAt)}] {log.eventType} · {log.status}
                          </p>
                          <p className="truncate text-zinc-500">{log.message ?? "—"}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {detailData.template ? (
                  <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Şablon önizleme</p>
                    <div className="h-64 overflow-hidden rounded-lg border border-white/10 bg-white">
                      <iframe
                        title="campaign-template-preview"
                        className="h-full w-full"
                        sandbox="allow-same-origin"
                        srcDoc={detailData.template.htmlBody}
                      />
                    </div>
                    {detailData.template.plainTextBody ? (
                      <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-zinc-950/60 p-2 text-xs text-zinc-300">
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
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
            <p className="text-base font-semibold text-white">Kampanya silinsin mi?</p>
            <p className="mt-2 text-sm text-zinc-400">Bu işlem kampanyayı listeden kaldırır. Teslimat kayıtları korunur.</p>
            <p className="mt-2 text-xs text-zinc-600">{deleteTarget.name}</p>
            <div className="mt-3">
              <label className="text-xs text-zinc-500">Onaylamak için DELETE yazın</label>
              <input
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-rose-400/50"
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
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                Vazgeç
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
                className="rounded-xl border border-rose-500/50 px-4 py-2 text-xs text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === `${deleteTarget.id}:delete` ? "Siliniyor…" : "Sil"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {queueConfirmAction ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
            <p className="text-base font-semibold text-white">Kuyruk temizleme onayı</p>
            <p className="mt-2 text-sm text-zinc-400">
              Bu işlem yalnızca iptal edilmiş, tamamlanmış, başarısız veya silinmiş kampanyalara ait kuyruk işlerini temizler. Aktif
              kampanyalar korunur.
            </p>
            <p className="mt-2 text-xs text-zinc-600">Onaylamak için TEMIZLE yazın.</p>
            <input
              value={queueConfirmText}
              onChange={(event) => setQueueConfirmText(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-400/50"
              placeholder="TEMIZLE"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setQueueConfirmAction(null);
                  setQueueConfirmText("");
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={queueConfirmText.trim().toUpperCase() !== "TEMIZLE" || queueActionLoading !== null}
                onClick={() => void runQueueAction(queueConfirmAction)}
                className="rounded-xl border border-amber-500/40 px-4 py-2 text-xs text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
              >
                {queueActionLoading ? "Çalışıyor…" : "Onayla"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCleanupRunning ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
              <Loader2 className="h-5 w-5 animate-spin text-amber-300" />
            </div>
            <p className="text-base font-semibold text-white">Kuyruk temizliği</p>
            <p className="mt-2 text-sm text-zinc-500">Eski işler taranıyor; aktif kampanyalar korunuyor.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={`rounded-lg border ${campaignTheme.border} bg-[#0a0e16] px-2 py-1.5`}>
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-white">{fmtInt(value)}</p>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={`rounded-lg border ${campaignTheme.border} bg-[#121722]/80 p-3`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <div className="mt-1 text-sm text-zinc-100">{value}</div>
    </div>
  );
}
