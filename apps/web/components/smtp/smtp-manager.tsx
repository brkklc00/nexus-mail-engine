"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  LayoutGrid,
  List,
  Loader2,
  MailX,
  Pencil,
  PlayCircle,
  PlugZap,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  Info
} from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { OverlayPortal } from "@/components/ui/overlay-portal";
import { getBulkAlibabaPreviewRows } from "@/lib/smtp-bulk-alibaba-parse";
import { LiveSmtpFlowCard } from "@/components/smtp/live-smtp-flow-card";

/** Alibaba DirectMail (AP Southeast 1) toplu içe aktarma — API ile aynı sabitler */
const ALIBABA_BULK_SMTP_DEFAULTS = {
  host: "smtpdm-ap-southeast-1.aliyuncs.com",
  port: 465,
  encryptionStored: "ssl",
  encryptionUi: "SSL / TLS (implicit · port 465)"
} as const;

type Account = {
  id: string;
  name: string;
  host: string;
  port: number;
  encryption: string;
  username: string;
  fromEmail: string;
  fromName: string | null;
  providerLabel: string | null;
  isActive: boolean;
  isThrottled: boolean;
  throttleReason: string | null;
  targetRatePerSecond: number;
  maxRatePerSecond: number | null;
  dailyCap: number | null;
  hourlyCap: number | null;
  minuteCap: number | null;
  warmupEnabled: boolean;
  warmupStartRps: number;
  warmupIncrementStep: number;
  warmupMaxRps: number | null;
  healthStatus: string;
  lastError: string | null;
  lastTestAt: string | null;
  cooldownUntil: string | null;
  tags: string[];
  groupLabel: string | null;
  connectionTimeout?: number | null;
  socketTimeout?: number | null;
  sentToday: number;
  failedToday: number;
  warmupTier: string | null;
  effectiveRps: number;
  statsUnavailable?: boolean;
};

type Metrics = {
  totalSmtpAccounts: number;
  activeSmtpAccounts: number;
  healthySmtpAccounts: number;
  throttledSmtpAccounts: number;
  totalSentToday: number;
  totalFailedToday: number;
  effectiveTotalRps: number;
  estimatedDailyCapacity: number;
};

type PlannerPreview = {
  usableCount: number;
  dailyTarget: number;
  globalRps: number;
  perSmtpRps: number;
  perSmtpDailyCap: number;
  perSmtpHourlyCap: number;
  perSmtpMinuteCap: number;
};

type DailyTargetSummary = {
  dailyTarget: number;
  mode: "safe" | "balanced" | "fast" | "aggressive";
  warmupPolicy?: "automatic_recommended" | "force_target" | "conservative";
  scope: "healthy_active" | "all_active" | "selected";
  usableSmtpCount: number;
  globalRps: number;
  effectiveGlobalRps: number;
  perSmtpRps: number;
  perSmtpDailyCap: number;
  perSmtpHourlyCap: number;
  perSmtpMinuteCap: number;
  updated: number;
  skipped: number;
  warnings: string[];
  warmupPoolCapacityDaily?: number;
  warmupBottleneckSmtpCount?: number;
  updatedAt?: string;
};

type BulkScope = "all_active" | "selected" | "healthy" | "error";
type BulkPreset = "safe" | "balanced" | "fast" | "aggressive" | "custom" | "daily_target";

type BulkWarmupValues = {
  targetRatePerSecond: number;
  maxRatePerSecond: number;
  warmupEnabled: boolean;
  warmupStartRps: number;
  warmupIncrementStep: number;
  warmupMaxRps: number;
  dailyCap: number;
  hourlyCap: number;
  minuteCap: number;
  resetThrottle: boolean;
  clearCooldown: boolean;
  clearLastError: boolean;
  onlyActive: boolean;
};

type BulkDistributionPreview = {
  totalSmtp: number;
  usableSmtpCount: number;
  dailyTarget: number;
  globalRps: number;
  perSmtpRps: number;
  perSmtpDailyCap: number;
  perSmtpHourlyCap: number;
  perSmtpMinuteCap: number;
  estimatedTotalRps: number;
};

type PoolSettings = {
  sendingMode: "single" | "pool";
  useAllActiveByDefault: boolean;
  rotateEvery: number;
  rotateEveryN?: number;
  globalRatePerSecond: number;
  parallelSmtpCount: number;
  parallelSmtpLanes: number;
  perSmtpConcurrency: number;
  minDelayBetweenSendsMs: number;
  maxEmailsPerSmtpSession: number;
  connectionTimeoutSec: number;
  skipThrottled: boolean;
  skipUnhealthy: boolean;
  fallbackToNextOnError: boolean;
  retryCount: number;
  retryDelayMs: number;
  cooldownAfterErrorSec: number;
};

type BulkTestScope = "all_active" | "healthy" | "throttled" | "error" | "selected" | "filtered";
type BulkTestType = "connection" | "send_test_email" | "both";
type BulkTestResult = {
  smtpId: string;
  fromEmail: string;
  provider: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  latencyMs?: number;
  testedAt: string;
  testType: BulkTestType;
};

const defaultPoolSettings: PoolSettings = {
  sendingMode: "pool",
  useAllActiveByDefault: true,
  rotateEvery: 500,
  rotateEveryN: 500,
  globalRatePerSecond: 1,
  parallelSmtpCount: 2,
  parallelSmtpLanes: 2,
  perSmtpConcurrency: 1,
  minDelayBetweenSendsMs: 5,
  maxEmailsPerSmtpSession: 2000,
  connectionTimeoutSec: 60,
  skipThrottled: true,
  skipUnhealthy: true,
  fallbackToNextOnError: true,
  retryCount: 5,
  retryDelayMs: 2000,
  cooldownAfterErrorSec: 60
};

const dailyPresets = [5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000, 25000000, 50000000];
const dailyTargetQuickPresets = [100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000];
const modalTabs = ["connection", "identity", "rate", "warmup", "advanced"] as const;
type ModalTab = (typeof modalTabs)[number];
type ProviderPreset = "alibaba" | "custom";
type SmtpTab = "overview" | "accounts" | "live" | "advanced";

function modeLabel(mode: "safe" | "balanced" | "fast" | "aggressive") {
  if (mode === "safe") return "Guvenli";
  if (mode === "balanced") return "Dengeli";
  if (mode === "fast") return "Hizli";
  return "Agresif";
}

const BULK_PRESET_VALUES: Record<Exclude<BulkPreset, "custom" | "daily_target">, Pick<
  BulkWarmupValues,
  "targetRatePerSecond" | "maxRatePerSecond" | "warmupEnabled" | "warmupStartRps" | "warmupIncrementStep" | "warmupMaxRps"
>> = {
  safe: {
    targetRatePerSecond: 0.2,
    maxRatePerSecond: 0.5,
    warmupEnabled: true,
    warmupStartRps: 0.1,
    warmupIncrementStep: 0.1,
    warmupMaxRps: 1
  },
  balanced: {
    targetRatePerSecond: 0.5,
    maxRatePerSecond: 1,
    warmupEnabled: true,
    warmupStartRps: 0.2,
    warmupIncrementStep: 0.2,
    warmupMaxRps: 2
  },
  fast: {
    targetRatePerSecond: 1,
    maxRatePerSecond: 2,
    warmupEnabled: true,
    warmupStartRps: 0.5,
    warmupIncrementStep: 0.5,
    warmupMaxRps: 3
  },
  aggressive: {
    targetRatePerSecond: 2,
    maxRatePerSecond: 5,
    warmupEnabled: true,
    warmupStartRps: 1,
    warmupIncrementStep: 1,
    warmupMaxRps: 5
  }
};

const SMTP_VIEW_STORAGE_KEY = "nexus-smtp-accounts-view-mode";

export function SmtpManager({
  initialAccounts,
  initialMetrics,
  initialPoolSettings,
  initialDailyTargetSummary
}: {
  initialAccounts: Account[];
  initialMetrics: Metrics;
  initialPoolSettings: Partial<PoolSettings> | null;
  initialDailyTargetSummary?: Partial<DailyTargetSummary> | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [baselineMetrics, setBaselineMetrics] = useState(initialMetrics);
  const [poolSettings, setPoolSettings] = useState<PoolSettings>(() => {
    const initial = (initialPoolSettings ?? {}) as Partial<PoolSettings>;
    const parallelSmtpCount = Math.max(
      1,
      Number(initial.parallelSmtpCount ?? initial.parallelSmtpLanes ?? defaultPoolSettings.parallelSmtpCount)
    );
    const rotateEvery = Math.max(10, Number(initial.rotateEveryN ?? initial.rotateEvery ?? defaultPoolSettings.rotateEvery));
    return {
      ...defaultPoolSettings,
      ...initial,
      rotateEvery,
      rotateEveryN: rotateEvery,
      parallelSmtpCount,
      parallelSmtpLanes: parallelSmtpCount,
      globalRatePerSecond:
        typeof initial.globalRatePerSecond === "number" && Number.isFinite(initial.globalRatePerSecond)
          ? Math.max(0.01, Number(initial.globalRatePerSecond))
          : defaultPoolSettings.globalRatePerSecond
    };
  });
  const [poolSaving, setPoolSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showBulkAlibabaModal, setShowBulkAlibabaModal] = useState(false);
  const [modalTab, setModalTab] = useState<ModalTab>("connection");
  const [providerPreset, setProviderPreset] = useState<ProviderPreset>("custom");
  const [testResultModal, setTestResultModal] = useState<{
    open: boolean;
    accountName: string;
    connected: boolean;
    kind: string;
    message: string;
    recommendation?: string;
  }>({
    open: false,
    accountName: "",
    connected: false,
    kind: "",
    message: ""
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rateTargetDaily, setRateTargetDaily] = useState(() => {
    const initialGlobalRate = Number((initialPoolSettings as any)?.globalRatePerSecond ?? 100000 / 86400);
    if (!Number.isFinite(initialGlobalRate) || initialGlobalRate <= 0) return 100000;
    return Math.max(1, Math.floor(initialGlobalRate * 86400));
  });
  const [rateMode, setRateMode] = useState<"automatic" | "manual">("automatic");
  const [manualRps, setManualRps] = useState(() =>
    Math.max(0.01, Number((initialPoolSettings as any)?.globalRatePerSecond ?? defaultPoolSettings.globalRatePerSecond))
  );
  const [form, setForm] = useState({
    name: "",
    providerLabel: "",
    host: "",
    port: 465,
    encryption: "tls",
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
    dailyCap: 0,
    hourlyCap: 0,
    minuteCap: 0,
    targetRatePerSecond: 1,
    maxRatePerSecond: 1,
    warmupEnabled: true,
    warmupStartRps: 1,
    warmupIncrementStep: 1,
    warmupMaxRps: 15,
    plannedSmtpCount: 1,
    connectionTimeout: 30000,
    socketTimeout: 60000,
    tags: "",
    groupLabel: ""
  });
  const [bulkAlibabaLines, setBulkAlibabaLines] = useState("");
  const [bulkAlibabaUpdateExisting, setBulkAlibabaUpdateExisting] = useState(false);
  const [bulkAlibabaTestAfterImport, setBulkAlibabaTestAfterImport] = useState(true);
  const [bulkAlibabaResult, setBulkAlibabaResult] = useState<{
    scanned: number;
    added: number;
    updated: number;
    skippedDuplicate: number;
    invalid: number;
    errors: string[];
  } | null>(null);

  const bulkAlibabaPreview = useMemo(() => getBulkAlibabaPreviewRows(bulkAlibabaLines), [bulkAlibabaLines]);

  const [viewMode, setViewMode] = useState<"card" | "list">(() =>
    initialAccounts.length > 10 ? "list" : "card"
  );
  const [activeTab, setActiveTab] = useState<SmtpTab>("overview");
  const [accountsLoaded, setAccountsLoaded] = useState(initialAccounts.length > 0);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [tableStatusFilter, setTableStatusFilter] = useState<"all" | "healthy" | "throttled" | "error" | "passive">("all");
  const [tableProviderFilter, setTableProviderFilter] = useState("all");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [accountsPage, setAccountsPage] = useState(1);
  const [accountsPageSize, setAccountsPageSize] = useState(25);
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleteTyped, setBulkDeleteTyped] = useState("");
  const [plannerModalOpen, setPlannerModalOpen] = useState(false);
  const [plannerIncludeUnhealthy, setPlannerIncludeUnhealthy] = useState(false);
  const [plannerIncludeThrottled, setPlannerIncludeThrottled] = useState(false);
  const [bulkWarmupModalOpen, setBulkWarmupModalOpen] = useState(false);
  const [bulkResetModalOpen, setBulkResetModalOpen] = useState(false);
  const [bulkTestModalOpen, setBulkTestModalOpen] = useState(false);
  const [bulkScope, setBulkScope] = useState<BulkScope>("all_active");
  const [bulkPreset, setBulkPreset] = useState<BulkPreset>("balanced");
  const [bulkDailyTarget, setBulkDailyTarget] = useState(1000000);
  const [bulkWarmupValues, setBulkWarmupValues] = useState<BulkWarmupValues>({
    targetRatePerSecond: 0.5,
    maxRatePerSecond: 1,
    warmupEnabled: true,
    warmupStartRps: 0.2,
    warmupIncrementStep: 0.2,
    warmupMaxRps: 2,
    dailyCap: 0,
    hourlyCap: 0,
    minuteCap: 0,
    resetThrottle: false,
    clearCooldown: false,
    clearLastError: false,
    onlyActive: true
  });
  const [bulkApplyPreview, setBulkApplyPreview] = useState<BulkDistributionPreview | null>(null);
  const [bulkResetIncludeAuthErrors, setBulkResetIncludeAuthErrors] = useState(false);
  const [bulkResetSetHealthy, setBulkResetSetHealthy] = useState(false);
  const [bulkTestScope, setBulkTestScope] = useState<BulkTestScope>("all_active");
  const [bulkTestType, setBulkTestType] = useState<BulkTestType>("connection");
  const [bulkTestRecipient, setBulkTestRecipient] = useState(process.env.NEXT_PUBLIC_SMTP_TEST_RECIPIENT ?? "");
  const [bulkTestConcurrency, setBulkTestConcurrency] = useState(5);
  const [bulkTestTimeoutSeconds, setBulkTestTimeoutSeconds] = useState(30);
  const [bulkTestUpdateHealth, setBulkTestUpdateHealth] = useState(true);
  const [bulkTestClearThrottleOnSuccess, setBulkTestClearThrottleOnSuccess] = useState(false);
  const [bulkTestNoAutoDisable, setBulkTestNoAutoDisable] = useState(true);
  const [bulkTestOnlyActive, setBulkTestOnlyActive] = useState(true);
  const [bulkTestJobId, setBulkTestJobId] = useState<string | null>(null);
  const [bulkTestStatus, setBulkTestStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [bulkTestTotal, setBulkTestTotal] = useState(0);
  const [bulkTestProcessed, setBulkTestProcessed] = useState(0);
  const [bulkTestResults, setBulkTestResults] = useState<BulkTestResult[]>([]);
  const [bulkTestSummary, setBulkTestSummary] = useState({ success: 0, failed: 0, skipped: 0 });
  const [bulkTestShowOnlyFailed, setBulkTestShowOnlyFailed] = useState(false);
  const [dailyTargetModalOpen, setDailyTargetModalOpen] = useState(false);
  const [dailyTargetInput, setDailyTargetInput] = useState(
    Math.max(100000, Number(initialDailyTargetSummary?.dailyTarget ?? 500000))
  );
  const [dailyTargetMode, setDailyTargetMode] = useState<"safe" | "balanced" | "fast" | "aggressive">(
    (initialDailyTargetSummary?.mode as any) ?? "balanced"
  );
  const [dailyTargetScope, setDailyTargetScope] = useState<"healthy_active" | "all_active" | "selected">(
    (initialDailyTargetSummary?.scope as any) ?? "healthy_active"
  );
  const [dailyTargetWarmupAutoAdjust, setDailyTargetWarmupAutoAdjust] = useState(true);
  const [dailyTargetForceTargetForWarmed, setDailyTargetForceTargetForWarmed] = useState(true);
  const [dailyTargetClearExpiredThrottle, setDailyTargetClearExpiredThrottle] = useState(true);
  const [dailyTargetUseAllEligibleParallel, setDailyTargetUseAllEligibleParallel] = useState(true);
  const [dailyTargetUpdateWorkerPool, setDailyTargetUpdateWorkerPool] = useState(true);
  const [dailyTargetApplyRunningCampaigns, setDailyTargetApplyRunningCampaigns] = useState(true);
  const [dailyTargetWarmupPolicy, setDailyTargetWarmupPolicy] = useState<"automatic_recommended" | "force_target" | "conservative">(
    (initialDailyTargetSummary?.warmupPolicy as any) ?? "automatic_recommended"
  );
  const [dailyTargetUpdateWarmupToTarget, setDailyTargetUpdateWarmupToTarget] = useState(true);
  const [dailyTargetExcludeUnhealthy, setDailyTargetExcludeUnhealthy] = useState(true);
  const [dailyTargetEnforceSuppression, setDailyTargetEnforceSuppression] = useState(true);
  const [dailyTargetSummary, setDailyTargetSummary] = useState<DailyTargetSummary>({
    dailyTarget: Math.max(100000, Number(initialDailyTargetSummary?.dailyTarget ?? 500000)),
    mode: ((initialDailyTargetSummary?.mode as any) ?? "balanced") as "safe" | "balanced" | "fast" | "aggressive",
    warmupPolicy: ((initialDailyTargetSummary?.warmupPolicy as any) ?? "automatic_recommended") as
      | "automatic_recommended"
      | "force_target"
      | "conservative",
    scope: ((initialDailyTargetSummary?.scope as any) ?? "healthy_active") as "healthy_active" | "all_active" | "selected",
    usableSmtpCount: Math.max(1, Number(initialDailyTargetSummary?.usableSmtpCount ?? initialMetrics.healthySmtpAccounts ?? 1)),
    globalRps: Number(initialDailyTargetSummary?.globalRps ?? 0),
    effectiveGlobalRps: Number(initialDailyTargetSummary?.effectiveGlobalRps ?? initialDailyTargetSummary?.globalRps ?? 0),
    perSmtpRps: Number(initialDailyTargetSummary?.perSmtpRps ?? 0),
    perSmtpDailyCap: Number(initialDailyTargetSummary?.perSmtpDailyCap ?? 0),
    perSmtpHourlyCap: Number(initialDailyTargetSummary?.perSmtpHourlyCap ?? 0),
    perSmtpMinuteCap: Number(initialDailyTargetSummary?.perSmtpMinuteCap ?? 0),
    updated: Number(initialDailyTargetSummary?.updated ?? 0),
    skipped: Number(initialDailyTargetSummary?.skipped ?? 0),
    warnings: Array.isArray(initialDailyTargetSummary?.warnings) ? (initialDailyTargetSummary?.warnings as string[]) : []
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SMTP_VIEW_STORAGE_KEY);
      if (stored === "card" || stored === "list") {
        setViewMode(stored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SMTP_VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (accounts.some((a) => a.id === id)) next.add(id);
      }
      return next;
    });
  }, [accounts]);

  const selectedCount = selectedIds.size;
  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);
  const providerOptions = useMemo(
    () => [...new Set(accounts.map((item) => (item.providerLabel ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [accounts]
  );
  const filteredAccounts = useMemo(() => {
    const search = tableSearch.trim().toLowerCase();
    return accounts.filter((item) => {
      if (search) {
        const haystack = `${item.fromEmail} ${item.name} ${item.host} ${item.providerLabel ?? ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (tableProviderFilter !== "all") {
        const provider = (item.providerLabel ?? "").trim().toLowerCase();
        if (provider !== tableProviderFilter.toLowerCase()) return false;
      }
      if (tableStatusFilter === "healthy") return item.isActive && !item.isThrottled && item.healthStatus === "healthy";
      if (tableStatusFilter === "throttled") return item.isThrottled;
      if (tableStatusFilter === "error") return item.healthStatus === "error";
      if (tableStatusFilter === "passive") return !item.isActive;
      return true;
    });
  }, [accounts, tableProviderFilter, tableSearch, tableStatusFilter]);
  const bulkTestVisibleResults = useMemo(
    () => (bulkTestShowOnlyFailed ? bulkTestResults.filter((item) => item.status === "failed") : bulkTestResults),
    [bulkTestResults, bulkTestShowOnlyFailed]
  );
  const totalAccountPages = useMemo(
    () => Math.max(1, Math.ceil(filteredAccounts.length / accountsPageSize)),
    [filteredAccounts.length, accountsPageSize]
  );
  const pagedAccounts = useMemo(() => {
    const safePage = Math.min(accountsPage, totalAccountPages);
    const start = (safePage - 1) * accountsPageSize;
    return filteredAccounts.slice(start, start + accountsPageSize);
  }, [filteredAccounts, accountsPage, accountsPageSize, totalAccountPages]);
  const allVisibleSelected = pagedAccounts.length > 0 && pagedAccounts.every((a) => selectedIds.has(a.id));

  useEffect(() => {
    setAccountsPage((prev) => Math.min(prev, totalAccountPages));
  }, [totalAccountPages]);

  async function refreshSmtpSnapshot() {
    setAccountsLoading(true);
    try {
      const response = await fetch("/api/smtp", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        accounts?: Account[];
        metrics?: Metrics;
      };
      if (!response.ok || !payload.ok || !payload.accounts || !payload.metrics) {
        throw new Error(payload.error ?? "SMTP list could not be refreshed");
      }
      setAccounts(payload.accounts);
      setBaselineMetrics(payload.metrics);
      setAccountsLoaded(true);
    } catch (error) {
      toast.error("SMTP list could not be refreshed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setAccountsLoading(false);
    }
  }

  async function openDailyTargetModal() {
    if (!accountsLoaded && !accountsLoading) {
      await refreshSmtpSnapshot();
    }
    setDailyTargetModalOpen(true);
  }

  useEffect(() => {
    if ((activeTab === "accounts" || activeTab === "advanced") && !accountsLoaded && !accountsLoading) {
      void refreshSmtpSnapshot();
    }
  }, [activeTab, accountsLoaded, accountsLoading]);

  useEffect(() => {
    if (!bulkTestJobId || bulkTestStatus !== "running") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await pollBulkTestJob(bulkTestJobId);
        if (cancelled) return;
        if (status === "completed" || status === "failed") {
          if (status === "completed") {
            toast.success("Toplu SMTP testi tamamlandı");
            await refreshSmtpSnapshot();
          } else {
            toast.error("Toplu SMTP testi başarısız oldu");
          }
          return;
        }
      } catch (error) {
        if (!cancelled) {
          toast.error("Toplu test durumu alınamadı", error instanceof Error ? error.message : "Beklenmeyen hata");
          setBulkTestStatus("failed");
        }
        return;
      }
      setTimeout(() => {
        if (!cancelled) void tick();
      }, 1000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [bulkTestJobId, bulkTestStatus]);

  function isAlibabaCandidate(host: string, providerLabel: string) {
    const h = host.toLowerCase();
    const p = providerLabel.toLowerCase();
    return h.includes("smtpdm") || p.includes("alibaba") || p.includes("aliyun");
  }

  function applySecurityDefaults(nextEncryption: string, currentPort: number) {
    if (nextEncryption === "ssl") return 465;
    if (nextEncryption === "tls" || nextEncryption === "starttls") return 587;
    return currentPort;
  }

  const plannedRps = rateMode === "automatic" ? Number((rateTargetDaily / 86400).toFixed(4)) : manualRps;
  const plannedMinute = Number((plannedRps * 60).toFixed(2));
  const plannedHour = Number((plannedRps * 3600).toFixed(2));
  const plannedDay = Math.floor(plannedRps * 86400);
  const plannerDailyTarget = Math.max(1, plannedDay);

  useEffect(() => {
    setPlannerIncludeThrottled(!(poolSettings.skipThrottled ?? true));
    setPlannerIncludeUnhealthy(!(poolSettings.skipUnhealthy ?? true));
  }, [poolSettings.skipThrottled, poolSettings.skipUnhealthy]);

  function buildPlannerPreview(
    includeUnhealthy: boolean,
    includeThrottled: boolean
  ): PlannerPreview {
    const usable = accounts.filter((item) => {
      if (!item.isActive || item.healthStatus === "archived") return false;
      if (!includeThrottled && item.isThrottled) return false;
      if (!includeUnhealthy && item.healthStatus === "error") return false;
      return true;
    });
    const usableCount = usable.length;
    const globalRps = Number((plannerDailyTarget / 86400).toFixed(6));
    const perSmtpRps = usableCount > 0 ? Number((globalRps / usableCount).toFixed(6)) : 0;
    const perSmtpDailyCap = usableCount > 0 ? Math.max(1, Math.ceil(plannerDailyTarget / usableCount)) : 0;
    const perSmtpHourlyCap = perSmtpDailyCap > 0 ? Math.max(1, Math.ceil(perSmtpDailyCap / 24)) : 0;
    const perSmtpMinuteCap = perSmtpHourlyCap > 0 ? Math.max(1, Math.ceil(perSmtpHourlyCap / 60)) : 0;
    return {
      usableCount,
      dailyTarget: plannerDailyTarget,
      globalRps,
      perSmtpRps,
      perSmtpDailyCap,
      perSmtpHourlyCap,
      perSmtpMinuteCap
    };
  }

  const plannerPreview = useMemo(
    () => buildPlannerPreview(plannerIncludeUnhealthy, plannerIncludeThrottled),
    [accounts, plannerDailyTarget, plannerIncludeUnhealthy, plannerIncludeThrottled]
  );

  const bulkTargetAccounts = useMemo(() => {
    const selectedSet = new Set(selectedIdList);
    return accounts.filter((account) => {
      if (bulkScope === "selected") return selectedSet.has(account.id);
      if (bulkScope === "all_active") return account.isActive;
      if (bulkScope === "healthy") return account.isActive && account.healthStatus === "healthy" && !account.isThrottled;
      return account.healthStatus === "error" || account.isThrottled;
    });
  }, [accounts, bulkScope, selectedIdList]);

  const bulkUsableAccounts = useMemo(
    () => bulkTargetAccounts.filter((account) => (bulkWarmupValues.onlyActive ? account.isActive : true)),
    [bulkTargetAccounts, bulkWarmupValues.onlyActive]
  );

  const bulkDistributionPreview = useMemo(() => {
    if (bulkPreset !== "daily_target") return null;
    const usableCount = bulkUsableAccounts.length;
    if (usableCount <= 0) return null;
    const dailyTarget = Math.max(1, Number(bulkDailyTarget || 0));
    const globalRps = Number((dailyTarget / 86400).toFixed(6));
    const perSmtpRps = Number((globalRps / usableCount).toFixed(6));
    const perSmtpDailyCap = Math.max(1, Math.ceil(dailyTarget / usableCount));
    const perSmtpHourlyCap = Math.max(1, Math.ceil(perSmtpDailyCap / 24));
    const perSmtpMinuteCap = Math.max(1, Math.ceil(perSmtpHourlyCap / 60));
    return {
      totalSmtp: bulkTargetAccounts.length,
      usableSmtpCount: usableCount,
      dailyTarget,
      globalRps,
      perSmtpRps,
      perSmtpDailyCap,
      perSmtpHourlyCap,
      perSmtpMinuteCap,
      estimatedTotalRps: Number((perSmtpRps * usableCount).toFixed(6))
    } satisfies BulkDistributionPreview;
  }, [bulkPreset, bulkDailyTarget, bulkTargetAccounts.length, bulkUsableAccounts.length]);

  useEffect(() => {
    if (bulkPreset === "custom" || bulkPreset === "daily_target") return;
    const presetValues = BULK_PRESET_VALUES[bulkPreset];
    setBulkWarmupValues((prev) => ({
      ...prev,
      ...presetValues
    }));
  }, [bulkPreset]);

  const warmupHelper = useMemo(() => {
    if (poolSettings.rotateEvery <= 250) return "100-250 is recommended for warmup SMTP accounts.";
    if (poolSettings.rotateEvery <= 700) return "Around 500 is ideal for regular SMTP distribution.";
    return "1000-2500 is suitable for high-trust SMTP accounts.";
  }, [poolSettings.rotateEvery]);
  const metrics = useMemo(() => {
    if (!accountsLoaded && accounts.length === 0) {
      return baselineMetrics;
    }
    const totalSmtpAccounts = accounts.length;
    const activeSmtpAccounts = accounts.filter((item) => item.isActive).length;
    const healthySmtpAccounts = accounts.filter((item) => item.isActive && item.healthStatus === "healthy" && !item.isThrottled).length;
    const throttledSmtpAccounts = accounts.filter((item) => item.isThrottled).length;
    const totalSentToday = Math.max(
      baselineMetrics.totalSentToday,
      accounts.reduce((sum, item) => sum + Number(item.sentToday ?? 0), 0)
    );
    const totalFailedToday = Math.max(
      baselineMetrics.totalFailedToday,
      accounts.reduce((sum, item) => sum + Number(item.failedToday ?? 0), 0)
    );
    const effectiveTotalRps = Number(
      accounts
        .filter((item) => item.isActive && !item.isThrottled)
        .reduce((sum, item) => sum + Number(item.effectiveRps ?? item.targetRatePerSecond ?? 0), 0)
        .toFixed(2)
    );
    return {
      totalSmtpAccounts,
      activeSmtpAccounts,
      healthySmtpAccounts,
      throttledSmtpAccounts,
      totalSentToday,
      totalFailedToday,
      effectiveTotalRps,
      estimatedDailyCapacity: Math.floor(effectiveTotalRps * 86400)
    };
  }, [accounts, accountsLoaded, baselineMetrics]);

  const dailyTargetPreview = useMemo(() => {
    const activeAccounts = accounts.filter((item) => item.isActive);
    const selectedActive = activeAccounts.filter((item) => selectedIds.has(item.id));
    let scoped = activeAccounts;
    if (dailyTargetScope === "healthy_active") {
      scoped = activeAccounts.filter((item) => item.healthStatus === "healthy" && !item.isThrottled);
    } else if (dailyTargetScope === "selected") {
      scoped = selectedActive;
    }
    if (dailyTargetExcludeUnhealthy) {
      scoped = scoped.filter((item) => item.healthStatus !== "error");
    }
    const usableSmtpCount = scoped.length;
    const dailyTarget = Math.max(1, Number(dailyTargetInput || 1));
    const globalRps = Number((dailyTarget / 86400).toFixed(6));
    const basePerSmtpRps = usableSmtpCount > 0 ? Number((globalRps / usableSmtpCount).toFixed(6)) : 0;
    const multiplier = dailyTargetMode === "safe" ? 0.5 : dailyTargetMode === "balanced" ? 0.75 : dailyTargetMode === "fast" ? 1 : 1.2;
    const modePerSmtpRps = basePerSmtpRps * multiplier;
    const perSmtpDailyCap = usableSmtpCount > 0 ? Math.max(1, Math.ceil(dailyTarget / usableSmtpCount)) : 0;
    const perSmtpHourlyCap = perSmtpDailyCap > 0 ? Math.max(1, Math.ceil(perSmtpDailyCap / 24)) : 0;
    const perSmtpMinuteCap = perSmtpHourlyCap > 0 ? Math.max(1, Math.ceil(perSmtpHourlyCap / 60)) : 0;
    const appliedRps = scoped.map((smtp) => {
      let rps = modePerSmtpRps;
      if (isAlibabaCandidate(smtp.host, smtp.providerLabel ?? "") && rps > 5) {
        rps = 5;
      }
      if ((smtp.sentToday ?? 0) < 500) {
        rps = Math.min(rps, 1);
      }
      return Math.max(0.01, Number(rps.toFixed(4)));
    });
    const effectiveGlobalRps = Number(appliedRps.reduce((sum, item) => sum + item, 0).toFixed(6));
    const warnings: string[] = [];
    if (usableSmtpCount === 0) {
      warnings.push("Kullanilabilir SMTP bulunamadi.");
    }
    if (usableSmtpCount > 0 && usableSmtpCount < 3) {
      warnings.push("Saglikli SMTP sayisi dusuk, hedefe ulasmak zor olabilir.");
    }
    if (modePerSmtpRps > 5 && scoped.some((smtp) => isAlibabaCandidate(smtp.host, smtp.providerLabel ?? ""))) {
      warnings.push("SMTP basi RPS provider guvenlik limitiyle sinirlandi.");
    }
    if (dailyTargetScope === "all_active" && dailyTargetExcludeUnhealthy) {
      warnings.push("Throttle olan SMTP'ler hariç tutuldu.");
    }
    if (dailyTargetMode === "aggressive" && dailyTarget >= 5_000_000) {
      warnings.push("Hedef cok yuksek; Agresif mod riskli olabilir.");
    }
    if (scoped.some((smtp) => (smtp.sentToday ?? 0) < 500)) {
      warnings.push("Bazi SMTP'ler yeni/isinmamis oldugu icin otomatik guvenli hiz uygulanacak.");
    }
    return {
      usableSmtpCount,
      dailyTarget,
      globalRps,
      perSmtpRps: usableSmtpCount > 0 ? Number((effectiveGlobalRps / usableSmtpCount).toFixed(6)) : 0,
      perSmtpDailyCap,
      perSmtpHourlyCap,
      perSmtpMinuteCap,
      effectiveGlobalRps,
      estimatedDailyCapacity: Math.floor(effectiveGlobalRps * 86400),
      warnings
    };
  }, [accounts, dailyTargetExcludeUnhealthy, dailyTargetInput, dailyTargetMode, dailyTargetScope, selectedIds]);

  async function applyDailyTarget() {
    if (dailyTargetPreview.usableSmtpCount <= 0) {
      toast.warning("Kullanilabilir SMTP bulunamadi", "Secim kapsamini veya SMTP durumlarini kontrol edin.");
      return;
    }
    if (dailyTargetScope === "selected" && selectedIds.size === 0) {
      toast.warning("Secili SMTP yok", "Listeden en az bir SMTP secin.");
      return;
    }
    setActionLoading("apply_daily_target");
    try {
      const response = await fetch("/api/smtp/apply-daily-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyTarget: Math.max(1, Number(dailyTargetInput || 1)),
          scope: dailyTargetScope,
          smtpAccountIds: dailyTargetScope === "selected" ? [...selectedIds] : undefined,
          warmupPolicy: dailyTargetWarmupPolicy,
          warmupAutoAdjust: dailyTargetWarmupAutoAdjust,
          updateWarmupToTarget: dailyTargetUpdateWarmupToTarget,
          forceTargetForWarmed: dailyTargetForceTargetForWarmed,
          clearExpiredThrottle: dailyTargetClearExpiredThrottle,
          useAllEligibleParallel: dailyTargetUseAllEligibleParallel,
          updateWorkerPoolSettings: dailyTargetUpdateWorkerPool,
          applyToRunningCampaigns: dailyTargetApplyRunningCampaigns,
          excludeUnhealthy: dailyTargetExcludeUnhealthy,
          enforceSuppressionChecks: dailyTargetEnforceSuppression
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & DailyTargetSummary;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Gunluk hedef uygulanamadi");
      }
      setDailyTargetSummary({
        dailyTarget: Number(payload.dailyTarget ?? dailyTargetInput),
        mode: (payload.mode ?? dailyTargetMode) as "safe" | "balanced" | "fast" | "aggressive",
        warmupPolicy: (payload.warmupPolicy ?? dailyTargetWarmupPolicy) as
          | "automatic_recommended"
          | "force_target"
          | "conservative",
        scope: (payload.scope ?? dailyTargetScope) as "healthy_active" | "all_active" | "selected",
        usableSmtpCount: Number(payload.usableSmtpCount ?? 0),
        globalRps: Number(payload.globalRps ?? 0),
        effectiveGlobalRps: Number(payload.effectiveGlobalRps ?? 0),
        perSmtpRps: Number(payload.perSmtpRps ?? 0),
        perSmtpDailyCap: Number(payload.perSmtpDailyCap ?? 0),
        perSmtpHourlyCap: Number(payload.perSmtpHourlyCap ?? 0),
        perSmtpMinuteCap: Number(payload.perSmtpMinuteCap ?? 0),
        warmupPoolCapacityDaily: Number(payload.warmupPoolCapacityDaily ?? 0),
        warmupBottleneckSmtpCount: Number(payload.warmupBottleneckSmtpCount ?? 0),
        updated: Number(payload.updated ?? 0),
        skipped: Number(payload.skipped ?? 0),
        warnings: Array.isArray(payload.warnings) ? payload.warnings : []
      });
      setDailyTargetModalOpen(false);
      toast.success(
        "Gunluk hedef uygulandi",
        `Guncellenen SMTP: ${Number(payload.updated ?? 0)}, SMTP basi RPS: ${Number(payload.perSmtpRps ?? 0).toFixed(2)}`
      );
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Gunluk hedef uygulanamadi", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  const activeSmtpCount = Math.max(1, accounts.filter((item) => item.isActive).length);
  const plannedSmtpCount = Math.max(1, Number(form.plannedSmtpCount || activeSmtpCount));
  const totalPlannedRps = rateMode === "automatic" ? rateTargetDaily / 86400 : manualRps;
  const perSmtpRps = totalPlannedRps / plannedSmtpCount;
  const isAlibabaPreset = providerPreset === "alibaba" || isAlibabaCandidate(form.host, form.providerLabel);
  const providerCap = isAlibabaPreset ? 15 : Number(form.maxRatePerSecond || 0) || Number.POSITIVE_INFINITY;
  const warmupCap = isAlibabaPreset ? 1 : form.warmupEnabled ? Number(form.warmupMaxRps || 0) || Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
  const calculatedTargetRps = (() => {
    if (isAlibabaPreset) {
      if (perSmtpRps > 0 && perSmtpRps < 1) return Number(perSmtpRps.toFixed(4));
      return 1;
    }
    const base = perSmtpRps > 0 ? perSmtpRps : Number(form.targetRatePerSecond || 1);
    return Number(Math.max(0.1, Math.min(base, providerCap, warmupCap)).toFixed(4));
  })();
  const calculatedMaxRps = (() => {
    if (isAlibabaPreset) {
      if (perSmtpRps > 0) return Number(Math.min(15, perSmtpRps).toFixed(4));
      return 15;
    }
    if (Number.isFinite(providerCap)) return Number(providerCap.toFixed(4));
    return Number(Math.max(calculatedTargetRps, Number(form.maxRatePerSecond || calculatedTargetRps)).toFixed(4));
  })();
  const estimatedPerSmtpDaily = Math.floor(calculatedTargetRps * 86400);

  function resetForm() {
    setForm({
      name: "",
      providerLabel: "",
      host: "",
      port: 465,
      encryption: "tls",
      username: "",
      password: "",
      fromEmail: "",
      fromName: "",
      dailyCap: 0,
      hourlyCap: 0,
      minuteCap: 0,
      targetRatePerSecond: 1,
      maxRatePerSecond: 1,
      warmupEnabled: true,
      warmupStartRps: 1,
      warmupIncrementStep: 1,
      warmupMaxRps: 15,
      plannedSmtpCount: Math.max(1, accounts.filter((item) => item.isActive).length || 1),
      connectionTimeout: 30000,
      socketTimeout: 60000,
      tags: "",
      groupLabel: ""
    });
    setModalTab("connection");
    setProviderPreset("custom");
    setEditingId(null);
  }

  function applyAlibabaPreset() {
    setForm((prev) => ({
      ...prev,
      host: "smtpdm-ap-southeast-1.aliyuncs.com",
      port: 465,
      encryption: "ssl",
      providerLabel: "alibaba",
      warmupEnabled: true,
      warmupStartRps: 1,
      warmupIncrementStep: 1,
      warmupMaxRps: 15,
      connectionTimeout: 30000,
      socketTimeout: 60000
    }));
  }

  function applyCalculatedDefaults() {
    setForm((prev) => ({
      ...prev,
      targetRatePerSecond: calculatedTargetRps,
      maxRatePerSecond: calculatedMaxRps
    }));
  }

  useEffect(() => {
    if (!showModal || editingId) return;
    applyCalculatedDefaults();
  }, [showModal, editingId, rateMode, rateTargetDaily, manualRps, form.plannedSmtpCount, providerPreset]);

  async function savePoolSettings() {
    setPoolSaving(true);
    try {
      const requestBody = {
        ...poolSettings,
        globalRatePerSecond: plannedRps,
        parallelSmtpCount: poolSettings.parallelSmtpCount,
        parallelSmtpLanes: poolSettings.parallelSmtpCount,
        rotateEvery: poolSettings.rotateEvery,
        rotateEveryN: poolSettings.rotateEvery,
        skipThrottled: poolSettings.skipThrottled,
        skipUnhealthy: poolSettings.skipUnhealthy
      };
      const response = await fetch("/api/smtp/pool-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const responsePayload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        settings?: Partial<PoolSettings>;
      };
      if (!response.ok || !responsePayload.ok) {
        throw new Error(responsePayload.error ?? "Pool settings could not be saved");
      }
      setPoolSettings((prev) => ({
        ...prev,
        globalRatePerSecond: plannedRps,
        parallelSmtpCount: Number(
          responsePayload.settings?.parallelSmtpCount ??
          responsePayload.settings?.parallelSmtpLanes ??
          prev.parallelSmtpCount
        ),
        parallelSmtpLanes: Number(
          responsePayload.settings?.parallelSmtpLanes ??
          responsePayload.settings?.parallelSmtpCount ??
          prev.parallelSmtpLanes
        )
      }));
      toast.success("Pool settings saved");
    } catch (error) {
      toast.error("Pool settings could not be saved", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setPoolSaving(false);
    }
  }

  async function applyPlannerToAllSmtps() {
    if (plannerPreview.usableCount <= 0) {
      toast.warning("No usable SMTP account", "Enable SMTP accounts or relax planner filters first.");
      return;
    }
    setActionLoading("apply_rate_planner");
    try {
      const response = await fetch("/api/smtp/apply-rate-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyTarget: plannerPreview.dailyTarget,
          includeUnhealthy: plannerIncludeUnhealthy,
          includeThrottled: plannerIncludeThrottled
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        smtpUpdated?: number;
        dailyTarget?: number;
        globalRps?: number;
        perSmtpRps?: number;
        perSmtpDailyCap?: number;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Rate planner could not be applied");
      }
      setPlannerModalOpen(false);
      toast.success(
        "Rate planner applied",
        `${payload.smtpUpdated ?? 0} SMTP updated · ${payload.perSmtpRps ?? 0} RPS/SMTP · ${payload.perSmtpDailyCap ?? 0} daily cap/SMTP`
      );
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Rate planner apply failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function applyBulkRateWarmup() {
    const targetCount = bulkUsableAccounts.length;
    if (targetCount <= 0) {
      toast.warning("Uygulanacak SMTP bulunamadi");
      return;
    }
    const approved = await confirm({
      title: "Toplu rate/warmup ayarlarini uygula?",
      message: `Bu islem ${targetCount} SMTP hesabinin rate/warmup ayarlarini guncelleyecek.`,
      confirmLabel: "Uygula",
      cancelLabel: "Iptal",
      tone: "warning"
    });
    if (!approved) return;

    setActionLoading("bulk_rate_warmup");
    try {
      const requestValues: Record<string, unknown> = {
        warmupEnabled: bulkWarmupValues.warmupEnabled,
        resetThrottle: bulkWarmupValues.resetThrottle,
        clearCooldown: bulkWarmupValues.clearCooldown,
        clearLastError: bulkWarmupValues.clearLastError,
        onlyActive: bulkWarmupValues.onlyActive
      };
      if (bulkPreset !== "daily_target") {
        requestValues.targetRatePerSecond = bulkWarmupValues.targetRatePerSecond;
        requestValues.maxRatePerSecond = bulkWarmupValues.maxRatePerSecond;
        requestValues.warmupStartRps = bulkWarmupValues.warmupStartRps;
        requestValues.warmupIncrementStep = bulkWarmupValues.warmupIncrementStep;
        requestValues.warmupMaxRps = bulkWarmupValues.warmupMaxRps;
      }
      if (bulkWarmupValues.dailyCap > 0) requestValues.dailyCap = bulkWarmupValues.dailyCap;
      if (bulkWarmupValues.hourlyCap > 0) requestValues.hourlyCap = bulkWarmupValues.hourlyCap;
      if (bulkWarmupValues.minuteCap > 0) requestValues.minuteCap = bulkWarmupValues.minuteCap;

      const response = await fetch("/api/smtp/bulk-rate-warmup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: bulkScope,
          smtpAccountIds: bulkScope === "selected" ? selectedIdList : undefined,
          preset: bulkPreset,
          dailyTarget: bulkPreset === "daily_target" ? bulkDailyTarget : undefined,
          values: requestValues
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        updated?: number;
        skipped?: number;
        preview?: BulkDistributionPreview | null;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Toplu ayar guncellenemedi");
      }
      setBulkApplyPreview(payload.preview ?? null);
      setBulkWarmupModalOpen(false);
      toast.success("SMTP rate/warmup ayarlari guncellendi.", `Guncellenen: ${payload.updated ?? 0}, atlanan: ${payload.skipped ?? 0}`);
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Toplu ayar islemi basarisiz", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  async function runBulkResetThrottle() {
    const targetCount = bulkUsableAccounts.length;
    if (targetCount <= 0) {
      toast.warning("Temizlenecek SMTP bulunamadi");
      return;
    }
    const approved = await confirm({
      title: "Rate limit / throttle temizlensin mi?",
      message: `Bu islem ${targetCount} SMTP hesabinda throttle/cooldown hata durumunu temizleyecek.`,
      confirmLabel: "Temizle",
      cancelLabel: "Iptal",
      tone: "warning"
    });
    if (!approved) return;

    setActionLoading("bulk_reset_throttle");
    try {
      const response = await fetch("/api/smtp/reset-throttle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: bulkScope,
          smtpAccountIds: bulkScope === "selected" ? selectedIdList : undefined,
          includeAuthErrors: bulkResetIncludeAuthErrors,
          setHealthy: bulkResetSetHealthy
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        updated?: number;
        authSkipped?: number;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Throttle temizleme basarisiz");
      }
      setBulkResetModalOpen(false);
      toast.success("SMTP throttle/rate limit durumu temizlendi.", `Guncellenen: ${payload.updated ?? 0}, auth skip: ${payload.authSkipped ?? 0}`);
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Throttle temizleme basarisiz", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  async function saveAccount(withTest = false) {
    setActionLoading("save_account");
    try {
      const isAlibaba = isAlibabaCandidate(form.host, form.providerLabel);
      const normalizedEncryption = isAlibaba
        ? "ssl"
        : form.encryption === "ssl"
          ? "ssl"
          : form.encryption === "tls" || form.encryption === "starttls"
            ? "tls"
            : "none";
      const normalizedPort = isAlibaba ? 465 : applySecurityDefaults(normalizedEncryption, Number(form.port));
      const body = {
        name: form.name,
        providerLabel: form.providerLabel || null,
        host: form.host,
        port: normalizedPort,
        encryption: normalizedEncryption,
        username: form.username,
        ...(form.password ? { password: form.password } : {}),
        fromEmail: form.fromEmail,
        fromName: form.fromName || null,
        dailyCap: form.dailyCap > 0 ? Number(form.dailyCap) : null,
        hourlyCap: form.hourlyCap > 0 ? Number(form.hourlyCap) : null,
        minuteCap: form.minuteCap > 0 ? Number(form.minuteCap) : null,
        targetRatePerSecond: Number(form.targetRatePerSecond),
        maxRatePerSecond: form.maxRatePerSecond > 0 ? Number(form.maxRatePerSecond) : null,
        warmupEnabled: form.warmupEnabled,
        warmupStartRps: Number(form.warmupStartRps),
        warmupIncrementStep: Number(form.warmupIncrementStep),
        warmupMaxRps: form.warmupMaxRps > 0 ? Number(form.warmupMaxRps) : null,
        connectionTimeout: form.connectionTimeout > 0 ? Number(form.connectionTimeout) : null,
        socketTimeout: form.socketTimeout > 0 ? Number(form.socketTimeout) : null,
        tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
        groupLabel: form.groupLabel || null
      };
      const response = await fetch(editingId ? `/api/smtp/${editingId}` : "/api/smtp", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
      if (!response.ok || !payload.ok || !payload.account) {
        throw new Error(payload.error ?? "SMTP could not be saved");
      }
      const saved = payload.account as Account;
      if (editingId) {
        setAccounts((prev) => prev.map((item) => (item.id === editingId ? ({ ...item, ...saved } as Account) : item)));
      } else {
        setAccounts((prev) => [saved, ...prev]);
      }
      toast.success(editingId ? "SMTP updated" : "SMTP created");
      if (withTest) {
        await testConnectionById(saved.id, saved.name);
      } else {
        setShowModal(false);
        resetForm();
      }
    } catch (error) {
      toast.error("SMTP could not be saved", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function toggleAccount(account: Account) {
    if (account.isActive) {
      const accepted = await confirm({
        title: "Disable SMTP account?",
        message: `"${account.name}" will not be used in new campaigns.`,
        confirmLabel: "Disable",
        cancelLabel: "Cancel",
        tone: "warning"
      });
      if (!accepted) return;
    }
    setActionLoading(`toggle:${account.id}`);
    const response = await fetch(`/api/smtp/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !account.isActive })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      toast.error("SMTP could not be updated", payload.error ?? "SMTP operation failed");
      setActionLoading(null);
      return;
    }
    setAccounts((prev) => prev.map((item) => (item.id === account.id ? payload.account! : item)));
    toast.info(payload.account.isActive ? "SMTP enabled" : "SMTP disabled");
    setActionLoading(null);
  }

  async function testConnectionById(accountId: string, accountName: string, options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (!silent) {
      setActionLoading(`test:${accountId}`);
    }
    const response = await fetch(`/api/smtp/${accountId}/test-connection`, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      errorKind?: string;
      recommendation?: string;
      result?: {
        connected?: boolean;
        kind?: string;
        message?: string;
      };
    };
    if (response.ok && payload.ok) {
      if (!silent) {
        toast.success("SMTP connection test succeeded");
      }
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === accountId ? { ...item, healthStatus: "healthy", lastError: null, lastTestAt: new Date().toISOString() } : item
        )
      );
      if (!silent) {
        setTestResultModal({
          open: true,
          accountName,
          connected: true,
          kind: payload.result?.kind ?? "connected",
          message: payload.result?.message ?? "SMTP connection successful."
        });
        setShowModal(false);
        resetForm();
      }
      if (!silent) {
        setActionLoading(null);
      }
      return true;
    }
    if (!silent) {
      toast.error("SMTP connection test failed", payload.error ?? "Connection could not be established.");
    }
    setAccounts((prev) =>
      prev.map((item) =>
        item.id === accountId
          ? { ...item, healthStatus: "error", lastError: payload.error ?? "Connection failed", lastTestAt: new Date().toISOString() }
          : item
      )
    );
    if (!silent) {
      setTestResultModal({
        open: true,
        accountName,
        connected: false,
        kind: payload.errorKind ?? "unknown",
        message: payload.error ?? "Connection failed",
        recommendation: payload.recommendation
      });
    }
    if (!silent) {
      setActionLoading(null);
    }
    return false;
  }

  async function testConnection(account: Account) {
    await testConnectionById(account.id, account.name);
  }

  function editAccount(account: Account) {
    setEditingId(account.id);
    setShowModal(true);
    setForm({
      name: account.name,
      providerLabel: account.providerLabel ?? "",
      host: account.host,
      port: account.port,
      encryption: account.encryption,
      username: account.username,
      password: "",
      fromEmail: account.fromEmail,
      fromName: account.fromName ?? "",
      dailyCap: account.dailyCap ?? 0,
      hourlyCap: account.hourlyCap ?? 0,
      minuteCap: account.minuteCap ?? 0,
      targetRatePerSecond: account.targetRatePerSecond ?? 1,
      maxRatePerSecond: account.maxRatePerSecond ?? 0,
      warmupEnabled: account.warmupEnabled,
      warmupStartRps: account.warmupStartRps ?? 1,
      warmupIncrementStep: account.warmupIncrementStep ?? 1,
      warmupMaxRps: account.warmupMaxRps ?? 0,
      plannedSmtpCount: Math.max(1, accounts.filter((item) => item.isActive).length || 1),
      connectionTimeout: account.connectionTimeout ?? 30000,
      socketTimeout: account.socketTimeout ?? 60000,
      tags: (account.tags ?? []).join(","),
      groupLabel: account.groupLabel ?? ""
    });
    setProviderPreset(isAlibabaCandidate(account.host, account.providerLabel ?? "") ? "alibaba" : "custom");
    setModalTab("connection");
  }

  async function resetThrottle(account: Account) {
    setActionLoading(`reset:${account.id}`);
    const response = await fetch(`/api/smtp/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_throttle" })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      toast.error("Throttle reset failed", payload.error ?? "SMTP operation failed");
      setActionLoading(null);
      return;
    }
    setAccounts((prev) => prev.map((item) => (item.id === account.id ? payload.account! : item)));
    toast.success("Throttle reset applied");
    setActionLoading(null);
  }

  async function removeAccount(account: Account) {
    const accepted = await confirm({
      title: "Delete SMTP account?",
      message: `"${account.name}" will be hard-deleted only if not in use. Otherwise it will be archived.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "danger"
    });
    if (!accepted) return;
    setActionLoading(`delete:${account.id}`);
    const response = await fetch(`/api/smtp/${account.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
      actionTaken?: string;
      campaignUsage?: number;
      campaignRecipientUsage?: number;
    };
    if (!response.ok || !payload.ok) {
      if (payload.code === "smtp_in_use") {
        toast.warning("SMTP is used in campaigns, archived instead of deleted.");
        setAccounts((prev) => prev.filter((item) => item.id !== account.id));
      } else {
        toast.error("SMTP could not be deleted", payload.error ?? "SMTP operation failed");
      }
      setActionLoading(null);
      return;
    }
    setAccounts((prev) => prev.filter((item) => item.id !== account.id));
    toast.success("SMTP deleted");
    setActionLoading(null);
  }

  async function disableAccount(account: Account) {
    const accepted = await confirm({
      title: "Disable SMTP?",
      message: `"${account.name}" will be removed from active pool.`,
      confirmLabel: "Disable",
      cancelLabel: "Cancel",
      tone: "warning"
    });
    if (!accepted) return;
    setActionLoading(`disable:${account.id}`);
    const response = await fetch(`/api/smtp/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable" })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; account?: Account };
    if (!response.ok || !payload.ok || !payload.account) {
      toast.error("Disable failed", payload.error ?? "SMTP operation failed");
      setActionLoading(null);
      return;
    }
    setAccounts((prev) => prev.map((item) => (item.id === account.id ? (payload.account as Account) : item)));
    toast.info("SMTP disabled");
    setActionLoading(null);
  }

  async function archiveAccount(account: Account) {
    const accepted = await confirm({
      title: "Archive SMTP?",
      message: `"${account.name}" will be removed from the list and active pool.`,
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      tone: "warning"
    });
    if (!accepted) return;
    setActionLoading(`archive:${account.id}`);
    const response = await fetch(`/api/smtp/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Archive failed", payload.error ?? "SMTP operation failed");
      setActionLoading(null);
      return;
    }
    setAccounts((prev) => prev.filter((item) => item.id !== account.id));
    toast.info("SMTP archived");
    setActionLoading(null);
  }

  function toggleRowSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (pagedAccounts.length === 0) return new Set();
      const next = new Set(prev);
      const all = pagedAccounts.every((a) => next.has(a.id));
      for (const account of pagedAccounts) {
        if (all) next.delete(account.id);
        else next.add(account.id);
      }
      return next;
    });
  }

  function openBulkTestModal() {
    setBulkTestScope(selectedCount > 0 ? "selected" : "all_active");
    setBulkTestType("connection");
    setBulkTestConcurrency(5);
    setBulkTestTimeoutSeconds(30);
    setBulkTestJobId(null);
    setBulkTestStatus("idle");
    setBulkTestTotal(0);
    setBulkTestProcessed(0);
    setBulkTestResults([]);
    setBulkTestSummary({ success: 0, failed: 0, skipped: 0 });
    setBulkTestShowOnlyFailed(false);
    setBulkTestModalOpen(true);
  }

  async function pollBulkTestJob(jobId: string) {
    const response = await fetch(`/api/smtp/bulk-test/${jobId}/status`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      status?: "running" | "completed" | "failed";
      total?: number;
      queuedOrProcessed?: number;
      results?: BulkTestResult[];
      summary?: { success: number; failed: number; skipped: number };
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Toplu SMTP test durumu alınamadı");
    }
    setBulkTestStatus(payload.status ?? "running");
    setBulkTestTotal(Number(payload.total ?? 0));
    setBulkTestProcessed(Number(payload.queuedOrProcessed ?? 0));
    setBulkTestResults(Array.isArray(payload.results) ? payload.results : []);
    setBulkTestSummary(
      payload.summary ?? { success: 0, failed: 0, skipped: 0 }
    );
    return payload.status ?? "running";
  }

  async function startBulkSmtpTest() {
    if ((bulkTestType === "send_test_email" || bulkTestType === "both") && !bulkTestRecipient.trim()) {
      toast.warning("Test alıcı e-postası gerekli", "Test maili gönderimi için geçerli bir alıcı girin.");
      return;
    }
    setActionLoading("bulk_test");
    try {
      const response = await fetch("/api/smtp/bulk-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: bulkTestScope,
          ids: bulkTestScope === "selected" ? selectedIdList : undefined,
          filters:
            bulkTestScope === "filtered"
              ? {
                  search: tableSearch,
                  status: tableStatusFilter,
                  provider: tableProviderFilter
                }
              : undefined,
          testType: bulkTestType,
          testRecipient: bulkTestRecipient.trim() || undefined,
          concurrency: bulkTestConcurrency,
          timeoutSeconds: bulkTestTimeoutSeconds,
          updateHealth: bulkTestUpdateHealth,
          clearThrottleOnSuccess: bulkTestClearThrottleOnSuccess,
          onlyActive: bulkTestOnlyActive,
          noAutoDisable: bulkTestNoAutoDisable
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; jobId?: string };
      if (!response.ok || !payload.ok || !payload.jobId) {
        throw new Error(payload.error ?? "Toplu SMTP testi başlatılamadı");
      }
      setBulkTestJobId(payload.jobId);
      setBulkTestStatus("running");
      toast.info("Toplu SMTP testi başlatıldı");
    } catch (error) {
      toast.error("Toplu SMTP testi başlatılamadı", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  /** İçe aktarılan SMTP kimlikleriyle doğrudan toplu bağlantı testi (seçim state’ine bağlı kalmaz). */
  async function runBulkSmtpTestForImportedIds(ids: string[]) {
    if (ids.length === 0) return;
    setBulkTestScope("selected");
    setSelectedIds(new Set(ids));
    setBulkTestType("connection");
    setBulkTestJobId(null);
    setBulkTestStatus("idle");
    setBulkTestTotal(0);
    setBulkTestProcessed(0);
    setBulkTestResults([]);
    setBulkTestSummary({ success: 0, failed: 0, skipped: 0 });
    setBulkTestShowOnlyFailed(false);
    setBulkTestModalOpen(true);
    setActionLoading("bulk_test");
    try {
      const response = await fetch("/api/smtp/bulk-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "selected",
          ids,
          testType: "connection",
          testRecipient: undefined,
          concurrency: bulkTestConcurrency,
          timeoutSeconds: bulkTestTimeoutSeconds,
          updateHealth: bulkTestUpdateHealth,
          clearThrottleOnSuccess: bulkTestClearThrottleOnSuccess,
          onlyActive: bulkTestOnlyActive,
          noAutoDisable: bulkTestNoAutoDisable
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; jobId?: string };
      if (!response.ok || !payload.ok || !payload.jobId) {
        throw new Error(payload.error ?? "Toplu SMTP testi başlatılamadı");
      }
      setBulkTestJobId(payload.jobId);
      setBulkTestStatus("running");
      toast.info("Bağlantı testi başlatıldı", `${ids.length} yeni içe aktarılan hesap`);
    } catch (error) {
      toast.error("İçe aktarma sonrası test başlatılamadı", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  function downloadBulkTestCsv() {
    if (bulkTestResults.length === 0) return;
    const rows = [
      ["smtpId", "fromEmail", "provider", "testType", "status", "latencyMs", "error", "testedAt"].join(","),
      ...bulkTestResults.map((item) =>
        [
          item.smtpId,
          item.fromEmail,
          item.provider,
          item.testType,
          item.status,
          String(item.latencyMs ?? ""),
          String(item.error ?? ""),
          item.testedAt
        ]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(",")
      )
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `smtp-bulk-test-${new Date().toISOString().slice(0, 19)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function bulkClearThrottleSelected() {
    if (selectedIdList.length === 0) return;
    setActionLoading("bulk_reset_selected");
    try {
      const response = await fetch("/api/smtp/reset-throttle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "selected",
          smtpAccountIds: selectedIdList,
          includeAuthErrors: false,
          setHealthy: false
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; reset?: number };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Toplu throttle temizleme başarısız oldu");
      }
      toast.success("Seçili throttle temizleme tamamlandı", `${Number(payload.reset ?? 0)} SMTP güncellendi`);
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Toplu throttle temizleme başarısız", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  async function bulkDisableSelected() {
    if (selectedIdList.length === 0) return;
    setActionLoading("bulk_disable");
    try {
      for (const id of selectedIdList) {
        const response = await fetch(`/api/smtp/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "disable" })
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `Disable failed for ${id.slice(0, 8)}…`);
        }
      }
      toast.success(`Disabled ${selectedIdList.length} SMTP account(s)`);
      setSelectedIds(new Set());
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Bulk disable failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function bulkEnableSelected() {
    if (selectedIdList.length === 0) return;
    setActionLoading("bulk_enable");
    try {
      for (const id of selectedIdList) {
        const response = await fetch(`/api/smtp/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true })
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `Enable failed for ${id.slice(0, 8)}…`);
        }
      }
      toast.success(`Enabled ${selectedIdList.length} SMTP account(s)`);
      setSelectedIds(new Set());
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Bulk enable failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function bulkArchiveSelected() {
    if (selectedIdList.length === 0) return;
    const accepted = await confirm({
      title: "Archive selected SMTP accounts?",
      message: `${selectedIdList.length} account(s) will be removed from the list and disabled.`,
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      tone: "warning"
    });
    if (!accepted) return;
    setActionLoading("bulk_archive");
    try {
      for (const id of selectedIdList) {
        const response = await fetch(`/api/smtp/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive" })
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `Archive failed for ${id.slice(0, 8)}…`);
        }
      }
      toast.info(`Archived ${selectedIdList.length} SMTP account(s)`);
      setSelectedIds(new Set());
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Bulk archive failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function executeBulkDelete() {
    if (selectedIdList.length === 0 || bulkDeleteTyped !== "DELETE") return;
    setActionLoading("bulk_delete");
    try {
      const response = await fetch("/api/smtp/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIdList })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        deleted?: number;
        skipped?: number;
        errors?: string[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Bulk delete failed");
      }
      const deleted = Number(payload.deleted ?? 0);
      const skipped = Number(payload.skipped ?? 0);
      const errList = payload.errors ?? [];
      toast.success(
        "SMTP accounts removed",
        `${deleted} archived${skipped > 0 ? `, ${skipped} skipped` : ""}${errList.length ? ` (${errList.length} messages)` : ""}`
      );
      setBulkDeleteModalOpen(false);
      setBulkDeleteTyped("");
      setSelectedIds(new Set());
      await refreshSmtpSnapshot();
    } catch (error) {
      toast.error("Bulk delete failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function submitBulkAlibabaImport() {
    if (!bulkAlibabaLines.trim()) {
      toast.warning("En az bir satır girin", "Her satır: eposta:sifre (ilk iki nokta üst üste ayrımı)");
      return;
    }
    const accepted = await confirm({
      title: "Toplu Alibaba SMTP içe aktarılsın mı?",
      message:
        "Satırlar Alibaba DirectMail sabitleriyle (host, port, şifreleme) kaydedilir. Mevcut hesapları güncelle seçeneği açıksa aynı gönderen e-postasına sahip kayıtların şifresi ve alanları güncellenir.",
      confirmLabel: "İçe aktar",
      cancelLabel: "İptal",
      tone: "warning"
    });
    if (!accepted) return;

    setActionLoading("bulk_alibaba_import");
    try {
      const response = await fetch("/api/smtp/bulk-add-alibaba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: bulkAlibabaLines,
          updateExisting: bulkAlibabaUpdateExisting
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        scanned?: number;
        added?: number;
        updated?: number;
        skippedDuplicate?: number;
        invalid?: number;
        errors?: string[];
        importedIds?: string[];
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Toplu içe aktarma başarısız");
      }
      const importedIds = Array.isArray(payload.importedIds) ? payload.importedIds.map(String) : [];
      const summary = {
        scanned: Number(payload.scanned ?? 0),
        added: Number(payload.added ?? 0),
        updated: Number(payload.updated ?? 0),
        skippedDuplicate: Number(payload.skippedDuplicate ?? 0),
        invalid: Number(payload.invalid ?? 0),
        errors: payload.errors ?? []
      };
      setBulkAlibabaResult(summary);
      toast.success(
        "Toplu içe aktarma tamamlandı",
        `Taranan: ${summary.scanned}, eklenen: ${summary.added}, güncellenen: ${summary.updated}, atlanan (yinelenen): ${summary.skippedDuplicate}, geçersiz: ${summary.invalid}`
      );
      await refreshSmtpSnapshot();
      if (bulkAlibabaTestAfterImport && importedIds.length > 0) {
        setShowBulkAlibabaModal(false);
        await runBulkSmtpTestForImportedIds(importedIds);
      }
    } catch (error) {
      toast.error("Toplu içe aktarma başarısız", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-base font-semibold text-white">SMTP Hesapları</p>
            <p className="text-xs text-zinc-400">SMTP havuzunu yönetin, günlük hedef belirleyin ve gönderim sağlığını izleyin.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void openDailyTargetModal()}
              className="inline-flex items-center justify-center rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white"
            >
              Günlük Gönderim Hedefi Ayarla
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200"
            >
              SMTP Ekle
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { id: "overview" as const, label: "Genel Bakış" },
            { id: "accounts" as const, label: "SMTP Hesapları" },
            { id: "live" as const, label: "Canlı Akış" },
            { id: "advanced" as const, label: "Gelişmiş Ayarlar" }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                activeTab === tab.id ? "border-indigo-400/50 bg-indigo-500/10 text-indigo-200" : "border-border text-zinc-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "overview" ? (
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Toplam SMTP" value={metrics.totalSmtpAccounts} icon={BarChart3} />
        <MetricCard title="Aktif SMTP" value={metrics.activeSmtpAccounts} icon={CheckCircle2} tone="success" />
        <MetricCard title="Saglikli SMTP" value={metrics.healthySmtpAccounts} icon={PlayCircle} tone="success" />
        <MetricCard title="Throttle SMTP" value={metrics.throttledSmtpAccounts} icon={ShieldAlert} tone="warning" />
        <MetricCard title="Bugun gonderilen" value={metrics.totalSentToday} icon={CheckCircle2} />
        <MetricCard title="Bugun basarisiz" value={metrics.totalFailedToday} icon={MailX} tone="danger" />
        <MetricCard title="Efektif toplam RPS" value={metrics.effectiveTotalRps} icon={RefreshCw} />
        <MetricCard title="Tahmini gunluk kapasite" value={metrics.estimatedDailyCapacity} icon={BarChart3} />
      </section>
      ) : null}

      {activeTab === "overview" ? (
      <section className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-base font-semibold text-white">Gunluk Gonderim Hedefi Ayarla</p>
            <p className="mt-1 text-xs text-zinc-300">
              Gunluk hedefi girin, sistem tum aktif SMTP hesaplarini otomatik olarak guvenli hiz, warmup ve limit degerleriyle ayarlasin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void openDailyTargetModal()}
            className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/20"
          >
            Gunluk Gonderim Hedefi Ayarla
          </button>
        </div>
        <div className="mt-3 grid gap-2 rounded-xl border border-border bg-zinc-900/50 p-3 text-xs text-zinc-200 md:grid-cols-2 xl:grid-cols-4">
          <p>Global günlük hedef: {Number(dailyTargetSummary.dailyTarget || 0).toLocaleString()}/gün</p>
          <p>Uygun SMTP: {Number(dailyTargetSummary.usableSmtpCount || 0)}</p>
          <p>SMTP basi hiz: {Number(dailyTargetSummary.perSmtpRps || 0).toFixed(2)}/s</p>
          <p>Beklenen toplam hiz: {Number(dailyTargetSummary.effectiveGlobalRps || dailyTargetSummary.globalRps || 0).toFixed(2)}/s</p>
          <p>
            Warmup politikası:{" "}
            {dailyTargetSummary.warmupPolicy === "force_target"
              ? "hedef hıza geç"
              : dailyTargetSummary.warmupPolicy === "conservative"
                ? "koruyucu"
                : "otomatik önerilen"}
          </p>
          <p>Warmup efektif havuz kapasitesi: {Number(dailyTargetSummary.warmupPoolCapacityDaily ?? 0).toLocaleString()}/gün</p>
          <p>Warmup bottleneck SMTP: {Number(dailyTargetSummary.warmupBottleneckSmtpCount ?? 0)}</p>
        </div>
        {Number(dailyTargetSummary.warmupBottleneckSmtpCount ?? 0) > 0 ? (
          <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Warmup sınırı nedeniyle hedef hız düşüyor. Hedefi uygula butonuyla uygun SMTP’lerin warmup limitleri yükseltilebilir.
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void openDailyTargetModal()}
            className="rounded-lg border border-indigo-500/40 px-3 py-2 text-xs text-indigo-200"
          >
            Gunluk Hedefi Degistir
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("live")}
            className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200"
          >
            Canlı Akışı Aç
          </button>
        </div>
        <div className="mt-3 grid gap-2 rounded-xl border border-border bg-zinc-900/50 p-3 text-xs text-zinc-200 md:grid-cols-2 xl:grid-cols-4">
          <p>RPS: {metrics.effectiveTotalRps.toFixed(2)}</p>
          <p>Gönderilen/dk: -</p>
          <p>Başarısız/dk: -</p>
          <p>Aktif kampanya: -</p>
        </div>
      </section>
      ) : null}

      {activeTab === "advanced" ? (
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">SMTP Pool Settings</p>
          <button type="button" onClick={() => void savePoolSettings()} disabled={poolSaving} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200">
            {poolSaving ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : <Save className="inline h-3.5 w-3.5" />} Save Pool Settings
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SettingField
            label="Sending mode"
            helper="Choose how emails are sent. SMTP pool uses multiple SMTP accounts in rotation for better distribution."
          >
            <select value={poolSettings.sendingMode} onChange={(e) => setPoolSettings((s) => ({ ...s, sendingMode: e.target.value as "single" | "pool" }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
              <option value="single">Single SMTP</option>
              <option value="pool">SMTP pool</option>
            </select>
          </SettingField>

          <SettingField
            label="Rotate every N recipients per SMTP"
            helper="After sending this many emails, system switches to the next SMTP. Lower = better distribution, higher = fewer switches."
            tooltip="Recommended: 300–1000"
            badge="Recommended"
          >
            <input type="number" value={poolSettings.rotateEvery} onChange={(e) => setPoolSettings((s) => ({ ...s, rotateEvery: Number(e.target.value || 500), rotateEveryN: Number(e.target.value || 500) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Parallel SMTP count"
            helper="How many SMTP accounts are used at the same time. Higher = faster sending, but increases risk."
            tooltip="Recommended: 5–20 depending on SMTP pool size"
            badge="Recommended"
          >
            <input type="number" value={poolSettings.parallelSmtpCount} onChange={(e) => setPoolSettings((s) => ({ ...s, parallelSmtpCount: Number(e.target.value || 1), parallelSmtpLanes: Number(e.target.value || 1) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Max retries"
            helper="Number of retry attempts if sending fails before marking as failed."
          >
            <input type="number" value={poolSettings.retryCount} onChange={(e) => setPoolSettings((s) => ({ ...s, retryCount: Number(e.target.value || 0) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Min delay between sends (ms)"
            helper="Minimum delay in milliseconds between send operations per SMTP."
          >
            <input type="number" value={poolSettings.minDelayBetweenSendsMs} onChange={(e) => setPoolSettings((s) => ({ ...s, minDelayBetweenSendsMs: Number(e.target.value || 0) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Max emails per SMTP session"
            helper="Maximum number of emails sent before reconnecting SMTP."
            badge="Recommended"
          >
            <input type="number" value={poolSettings.maxEmailsPerSmtpSession} onChange={(e) => setPoolSettings((s) => ({ ...s, maxEmailsPerSmtpSession: Number(e.target.value || 0) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Connection timeout (seconds)"
            helper="Timeout in seconds before SMTP connection is considered failed."
          >
            <input type="number" value={poolSettings.connectionTimeoutSec} onChange={(e) => setPoolSettings((s) => ({ ...s, connectionTimeoutSec: Number(e.target.value || 0) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Use all active SMTPs"
            helper="If enabled, all active SMTPs are included in sending pool automatically."
          >
            <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs">
              <input type="checkbox" checked={poolSettings.useAllActiveByDefault} onChange={(e) => setPoolSettings((s) => ({ ...s, useAllActiveByDefault: e.target.checked }))} />
              Enabled
            </label>
          </SettingField>

          <SettingField
            label="Skip throttled SMTPs"
            helper="Temporarily exclude SMTPs that are currently rate limited or blocked."
          >
            <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs">
              <input type="checkbox" checked={poolSettings.skipThrottled} onChange={(e) => setPoolSettings((s) => ({ ...s, skipThrottled: e.target.checked }))} />
              Enabled
            </label>
          </SettingField>

          <SettingField
            label="Skip unhealthy SMTPs"
            helper="Exclude SMTPs that failed recent health checks."
          >
            <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs">
              <input type="checkbox" checked={poolSettings.skipUnhealthy} onChange={(e) => setPoolSettings((s) => ({ ...s, skipUnhealthy: e.target.checked }))} />
              Enabled
            </label>
          </SettingField>

          <SettingField
            label="Fallback to next SMTP on error"
            helper="If sending fails on one SMTP, automatically retry using another SMTP."
          >
            <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs">
              <input type="checkbox" checked={poolSettings.fallbackToNextOnError} onChange={(e) => setPoolSettings((s) => ({ ...s, fallbackToNextOnError: e.target.checked }))} />
              Enabled
            </label>
          </SettingField>

          <SettingField
            label="Per SMTP concurrency"
            helper="How many jobs can run in parallel on the same SMTP lane."
          >
            <input type="number" value={poolSettings.perSmtpConcurrency} onChange={(e) => setPoolSettings((s) => ({ ...s, perSmtpConcurrency: Number(e.target.value || 1) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Retry delay (ms)"
            helper="Delay before each retry attempt after a failed send."
          >
            <input type="number" value={poolSettings.retryDelayMs} onChange={(e) => setPoolSettings((s) => ({ ...s, retryDelayMs: Number(e.target.value || 0) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>

          <SettingField
            label="Cooldown after error (seconds)"
            helper="How long an SMTP stays in cooldown after an error occurs."
          >
            <input type="number" value={poolSettings.cooldownAfterErrorSec} onChange={(e) => setPoolSettings((s) => ({ ...s, cooldownAfterErrorSec: Number(e.target.value || 0) }))} className="w-full rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          </SettingField>
        </div>
        <p className="mt-2 text-xs text-zinc-400">Rotate every N recipients per SMTP. Lower = better distribution, higher = less switching. {warmupHelper}</p>
      </section>
      ) : null}

      {activeTab === "advanced" ? (
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">Global Rate Planner</p>
          <select value={rateMode} onChange={(e) => setRateMode(e.target.value as "automatic" | "manual")} className="rounded border border-border bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100">
            <option value="automatic">Automatic (daily / 86400)</option>
            <option value="manual">Manual RPS</option>
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          {rateMode === "automatic" ? (
            <input type="number" value={rateTargetDaily} onChange={(e) => setRateTargetDaily(Number(e.target.value || 0))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          ) : (
            <input type="number" step="0.01" value={manualRps} onChange={(e) => setManualRps(Number(e.target.value || 0))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          )}
          <RateStat label="Per second" value={plannedRps} />
          <RateStat label="Per minute" value={plannedMinute} />
          <RateStat label="Per hour" value={plannedHour} />
        </div>
        <div className="mt-2 text-xs text-zinc-300">Per day: {plannedDay.toLocaleString()}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {dailyPresets.map((preset) => (
            <button key={preset} type="button" onClick={() => { setRateMode("automatic"); setRateTargetDaily(preset); }} className="rounded border border-border px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-900">
              {preset >= 1000000 ? `${preset / 1000000}M/day` : `${Math.floor(preset / 1000)}k/day`}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setPlannerModalOpen(true)}
            disabled={actionLoading === "apply_rate_planner"}
            className="rounded-lg border border-emerald-400/40 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50"
          >
            {actionLoading === "apply_rate_planner" ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
            Apply planner to all SMTPs
          </button>
        </div>
      </section>
      ) : null}

      {activeTab === "accounts" ? (
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">SMTP Hesapları</p>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-zinc-400">{filteredAccounts.length} kayıt</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-zinc-500">
              Sayfa {accountsPage} / {totalAccountPages}
            </span>
            <div className="flex items-center rounded-lg border border-border bg-zinc-950/80 p-0.5">
              <button
                type="button"
                title="Kart görünümü"
                onClick={() => {
                  setViewMode("card");
                  setSelectedIds(new Set());
                  setAccountsPage(1);
                }}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
                  viewMode === "card" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Kart
              </button>
              <button
                type="button"
                title="Liste görünümü"
                onClick={() => {
                  setViewMode("list");
                  setAccountsPage(1);
                }}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
                  viewMode === "list" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                Liste
              </button>
            </div>
            <select
              value={accountsPageSize}
              onChange={(event) => {
                setAccountsPageSize(Number(event.target.value));
                setAccountsPage(1);
              }}
              className="rounded border border-border bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
            >
              <option value={25}>25 / sayfa</option>
              <option value={50}>50 / sayfa</option>
              <option value={100}>100 / sayfa</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
              <>
                <button
                  type="button"
                  onClick={() => openBulkTestModal()}
                  className="rounded-lg border border-blue-400/40 px-3 py-2 text-xs text-blue-200"
                >
                  Toplu SMTP Test Et
                </button>
                <button
                  type="button"
                  onClick={() => setBulkWarmupModalOpen(true)}
                  className="rounded-lg border border-emerald-400/40 px-3 py-2 text-xs text-emerald-200"
                >
                  Toplu Rate / Warmup Ayarla
                </button>
                <button
                  type="button"
                  onClick={() => setBulkResetModalOpen(true)}
                  className="rounded-lg border border-amber-400/40 px-3 py-2 text-xs text-amber-200"
                >
                  Toplu Throttle Temizle
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkAlibabaResult(null);
                    setShowBulkAlibabaModal(true);
                  }}
                  className="rounded-lg border border-indigo-400/40 px-3 py-2 text-xs text-indigo-200"
                >
                  Toplu SMTP (email:şifre · Alibaba)
                </button>
                <button type="button" onClick={() => { resetForm(); setShowModal(true); }} className="rounded-lg bg-accent px-3 py-2 text-xs text-white">
                  SMTP Ekle
                </button>
              </>
          </div>
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <input
            value={tableSearch}
            onChange={(event) => {
              setTableSearch(event.target.value);
              setAccountsPage(1);
            }}
            placeholder="SMTP ara..."
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
          />
          <select
            value={tableStatusFilter}
            onChange={(event) => {
              setTableStatusFilter(event.target.value as "all" | "healthy" | "throttled" | "error" | "passive");
              setAccountsPage(1);
            }}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="all">Durum: Tümü</option>
            <option value="healthy">Durum: Sağlıklı</option>
            <option value="throttled">Durum: Sınırlandı</option>
            <option value="error">Durum: Hatalı</option>
            <option value="passive">Durum: Pasif</option>
          </select>
          <select
            value={tableProviderFilter}
            onChange={(event) => {
              setTableProviderFilter(event.target.value);
              setAccountsPage(1);
            }}
            className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="all">Provider: Tümü</option>
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
          <div className="flex items-center justify-end text-xs text-zinc-400">
            {accountsLoading ? "Yükleniyor..." : `${filteredAccounts.length.toLocaleString()} kayıt`}
          </div>
        </div>

        {viewMode === "list" && selectedCount > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-100">
            <span className="font-medium text-white">{selectedCount} seçili</span>
            <button
              type="button"
              disabled={!!actionLoading}
              onClick={() => openBulkTestModal()}
              className="rounded border border-indigo-400/50 px-2 py-1 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              Seçili test et
            </button>
            <button
              type="button"
              disabled={!!actionLoading}
              onClick={() => void bulkClearThrottleSelected()}
              className="rounded border border-indigo-400/50 px-2 py-1 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              Seçili throttle temizle
            </button>
            <button
              type="button"
              disabled={!!actionLoading}
              onClick={() => void bulkDisableSelected()}
              className="rounded border border-indigo-400/50 px-2 py-1 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              Seçili pasifleştir
            </button>
            <button
              type="button"
              disabled={!!actionLoading}
              onClick={() => {
                setBulkDeleteTyped("");
                setBulkDeleteModalOpen(true);
              }}
              className="rounded border border-indigo-400/50 px-2 py-1 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              Seçili sil
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto rounded border border-border px-2 py-1 text-zinc-400 hover:text-zinc-200"
            >
              Seçimi temizle
            </button>
          </div>
        ) : null}

        {accounts.length === 0 ? (
          <EmptyState icon="server" title="SMTP hesabı bulunamadı" description="SMTP Ekle ile yeni hesap oluşturun." />
        ) : viewMode === "list" ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[820px] border-collapse text-left text-[11px] text-zinc-300">
              <thead className="sticky top-0 z-[1] bg-zinc-900/95 text-[10px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="border-b border-border px-2 py-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() => toggleSelectAllVisible()}
                      className="rounded border-border"
                      title="Select all"
                    />
                  </th>
                  <th className="border-b border-border px-2 py-2">E-posta</th>
                  <th className="border-b border-border px-2 py-2">Durum</th>
                  <th className="border-b border-border px-2 py-2">Hız</th>
                  <th className="border-b border-border px-2 py-2">Bugün</th>
                  <th className="border-b border-border px-2 py-2">Son Test</th>
                  <th className="border-b border-border px-2 py-2 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {pagedAccounts.map((account) => (
                  <Fragment key={account.id}>
                    <tr className="border-b border-border/50 hover:bg-zinc-900/40">
                      <td className="px-2 py-1.5 align-middle">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(account.id)}
                          onChange={() => toggleRowSelected(account.id)}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="max-w-[220px] truncate px-2 py-1.5 font-mono text-[10px]" title={account.fromEmail}>
                        {account.fromEmail}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <StatusBadge
                          label={!account.isActive ? "pasif" : account.isThrottled ? "sinirlandi" : account.healthStatus === "error" ? "hatali" : "saglikli"}
                          tone={!account.isActive ? "muted" : account.isThrottled ? "warning" : account.healthStatus === "error" ? "danger" : "success"}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{Number(account.targetRatePerSecond ?? 0).toFixed(2)} rps</td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-zinc-200">
                        {account.sentToday} / {account.failedToday}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-zinc-400">
                        {account.lastTestAt
                          ? new Date(account.lastTestAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-nowrap justify-end gap-1">
                          <button
                            type="button"
                            title="Detay"
                            onClick={() => setExpandedRowId((prev) => (prev === account.id ? null : account.id))}
                            className="rounded border border-border p-1.5 text-zinc-300 hover:bg-zinc-800"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Test"
                            onClick={() => void testConnection(account)}
                            disabled={actionLoading === `test:${account.id}`}
                            className="rounded border border-border p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {actionLoading === `test:${account.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" title="Düzenle" onClick={() => void editAccount(account)} className="rounded border border-border p-1.5 text-zinc-300 hover:bg-zinc-800">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Throttle temizle"
                            onClick={() => void resetThrottle(account)}
                            disabled={actionLoading === `reset:${account.id}`}
                            className="rounded border border-amber-400/40 p-1.5 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                          <Link href={`/logs?q=${account.id}`} className="rounded border border-border p-1.5 text-zinc-300 hover:bg-zinc-800" title="Loglar">
                            <BarChart3 className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            type="button"
                            title={account.isActive ? "Pasifleştir" : "Aktifleştir"}
                            onClick={() => void toggleAccount(account)}
                            disabled={actionLoading === `toggle:${account.id}`}
                            className="rounded border border-border p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {account.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            title="Sil"
                            onClick={() => void removeAccount(account)}
                            disabled={actionLoading === `delete:${account.id}`}
                            className="rounded border border-rose-400/40 p-1.5 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedRowId === account.id ? (
                      <tr className="border-b border-border/40 bg-zinc-900/30">
                        <td colSpan={7} className="px-3 py-2 text-xs text-zinc-300">
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            <p>Provider: {account.providerLabel ?? "-"}</p>
                            <p>Host: {account.host}:{account.port}</p>
                            <p>Security: {account.encryption}</p>
                            <p>Username: {account.username}</p>
                            <p>Warmup: {account.warmupEnabled ? "Açık" : "Kapalı"}</p>
                            <p>Warmup Tier: {account.warmupTier ?? "-"}</p>
                            <p>Max RPS: {account.maxRatePerSecond ?? "-"}</p>
                            <p>Son hata: {account.lastError ?? "-"}</p>
                            <p>Istatistik: {account.statsUnavailable ? "Kullanilamiyor" : "Hazir"}</p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {pagedAccounts.map((account) => (
              <article key={account.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{account.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      {account.fromEmail} · {account.providerLabel ?? "custom"} · {account.host}:{account.port} · {account.encryption.toUpperCase()}
                    </p>
                  </div>
                  <StatusBadge
                    label={!account.isActive ? "disabled" : account.isThrottled ? "throttled" : account.healthStatus === "error" ? "error" : "healthy"}
                    tone={!account.isActive ? "muted" : account.isThrottled ? "warning" : account.healthStatus === "error" ? "danger" : "success"}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-zinc-300">
                  <p>Target/Max RPS: {account.targetRatePerSecond}/{account.maxRatePerSecond ?? "-"}</p>
                  <p>Warmup tier: {account.warmupTier ?? "-"}</p>
                  <p>Sent/Failed today: {account.statsUnavailable ? "Istatistik kullanilamiyor" : `${account.sentToday}/${account.failedToday}`}</p>
                  <p>Last test: {account.lastTestAt ? new Date(account.lastTestAt).toLocaleString() : "-"}</p>
                </div>
                <p className="mt-3 text-xs text-zinc-500">Last error: {account.lastError ?? "-"}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void toggleAccount(account)} disabled={actionLoading === `toggle:${account.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-50">
                    {account.isActive ? "Disable" : "Enable"}
                  </button>
                  <button type="button" onClick={() => void disableAccount(account)} disabled={actionLoading === `disable:${account.id}`} className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-50">
                    Disable
                  </button>
                  <button type="button" onClick={() => void archiveAccount(account)} disabled={actionLoading === `archive:${account.id}`} className="rounded-lg border border-zinc-500/50 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50">
                    Archive
                  </button>
                  <button type="button" onClick={() => void editAccount(account)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200">
                    Edit
                  </button>
                  <button type="button" onClick={() => void testConnection(account)} disabled={actionLoading === `test:${account.id}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-50">
                    {actionLoading === `test:${account.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                    Test Connection
                  </button>
                  <button type="button" onClick={() => void resetThrottle(account)} disabled={actionLoading === `reset:${account.id}`} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-50">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reset Throttle
                  </button>
                  <Link href={`/logs?q=${account.id}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-zinc-200">
                    View Logs
                  </Link>
                  <button type="button" onClick={() => void removeAccount(account)} disabled={actionLoading === `delete:${account.id}`} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
                {account.cooldownUntil ? (
                  <p className="mt-3 flex items-center gap-1 text-xs text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Cooldown until {new Date(account.cooldownUntil).toLocaleTimeString()}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {filteredAccounts.length > accountsPageSize ? (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-zinc-400">
            <button
              type="button"
              onClick={() => setAccountsPage((prev) => Math.max(1, prev - 1))}
              disabled={accountsPage <= 1}
              className="rounded border border-border px-2 py-1 text-zinc-300 disabled:opacity-50"
            >
              Onceki
            </button>
            <span>
              Sayfa {accountsPage} / {totalAccountPages}
            </span>
            <button
              type="button"
              onClick={() => setAccountsPage((prev) => Math.min(totalAccountPages, prev + 1))}
              disabled={accountsPage >= totalAccountPages}
              className="rounded border border-border px-2 py-1 text-zinc-300 disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        ) : null}
      </section>
      ) : null}

      {activeTab === "live" ? <LiveSmtpFlowCard /> : null}

      {dailyTargetModalOpen ? (
        <OverlayPortal active={dailyTargetModalOpen} lockScroll>
          <div className="fixed inset-0 z-[57] bg-black/70 p-4 backdrop-blur-sm" onClick={() => setDailyTargetModalOpen(false)}>
            <div className="mx-auto mt-10 w-full max-w-4xl rounded-2xl border border-indigo-500/40 bg-zinc-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-base font-semibold text-white">Gunluk Gonderim Hedefi</p>
              <p className="mt-1 text-xs text-zinc-300">
                Gunluk toplam gonderim hedefinizi girin. Sistem aktif SMTP havuzuna gore SMTP basi hiz, limit ve warmup ayarlarini otomatik hesaplar.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Gunluk hedef" helper="Ornek: 100000, 500000, 1000000, 5000000">
                  <NumberInput value={dailyTargetInput} onChange={(value) => setDailyTargetInput(Math.max(1, value))} />
                </Field>
                <Field label="Warmup politikası" helper="Hedef hıza ulaşım için warmup davranışı">
                  <SelectInput
                    value={dailyTargetWarmupPolicy}
                    onChange={(value) => setDailyTargetWarmupPolicy(value as "automatic_recommended" | "force_target" | "conservative")}
                    options={[
                      { value: "automatic_recommended", label: "Otomatik önerilen" },
                      { value: "force_target", label: "Hedef hıza geç" },
                      { value: "conservative", label: "Koruyucu" }
                    ]}
                  />
                </Field>
                <Field label="Mod secimi" helper="Gonderim hizi ve warmup guvenlik carpani">
                  <SelectInput
                    value={dailyTargetMode}
                    onChange={(value) => setDailyTargetMode(value as "safe" | "balanced" | "fast" | "aggressive")}
                    options={[
                      { value: "safe", label: "Guvenli" },
                      { value: "balanced", label: "Dengeli" },
                      { value: "fast", label: "Hizli" },
                      { value: "aggressive", label: "Agresif" }
                    ]}
                  />
                </Field>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {dailyTargetQuickPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDailyTargetInput(preset)}
                    className="rounded border border-border px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-900"
                  >
                    {preset >= 1000000 ? `${preset / 1000000}M / gun` : `${Math.floor(preset / 1000)}K / gun`}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Kullanilacak SMTP kapsami" helper="Hedefin hangi SMTP havuzuna dagitilacagini secin">
                  <SelectInput
                    value={dailyTargetScope}
                    onChange={(value) => setDailyTargetScope(value as "healthy_active" | "all_active" | "selected")}
                    options={[
                      { value: "healthy_active", label: "Tum aktif ve saglikli SMTP'ler" },
                      { value: "all_active", label: "Tum aktif SMTP'ler" },
                      { value: "selected", label: "Sadece secili SMTP'ler" }
                    ]}
                  />
                </Field>
                <div className="rounded-xl border border-border bg-zinc-900/40 p-3 text-xs text-zinc-300">
                  <p className="font-medium text-zinc-100">Mod Aciklamasi</p>
                  <p className="mt-1">
                    {dailyTargetMode === "safe"
                      ? "Yeni SMTP havuzu veya dusuk riskli gonderim icin."
                      : dailyTargetMode === "balanced"
                        ? "Gunluk duzenli gonderim icin onerilir."
                        : dailyTargetMode === "fast"
                          ? "Saglikli SMTP havuzu icin daha yuksek hiz."
                          : "Yuksek hacim icin. Sadece saglam SMTP havuzunda kullanin."}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-border bg-zinc-900/40 p-3 text-xs text-zinc-300 md:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetUseAllEligibleParallel} onChange={(e) => setDailyTargetUseAllEligibleParallel(e.target.checked)} /> Tüm uygun SMTP’leri paralel kullan</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetWarmupAutoAdjust} onChange={(e) => setDailyTargetWarmupAutoAdjust(e.target.checked)} /> Warmup limitlerini hedefe göre otomatik ayarla</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetUpdateWarmupToTarget} onChange={(e) => setDailyTargetUpdateWarmupToTarget(e.target.checked)} /> Hedef hıza geçmek için warmup sınırlarını güncelle</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetForceTargetForWarmed} onChange={(e) => setDailyTargetForceTargetForWarmed(e.target.checked)} /> Hedef hıza geç: yeterli geçmişi olan SMTP’lerde ısınma sınırını kaldır</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetClearExpiredThrottle} onChange={(e) => setDailyTargetClearExpiredThrottle(e.target.checked)} /> Süresi geçmiş throttle durumlarını temizle</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetUpdateWorkerPool} onChange={(e) => setDailyTargetUpdateWorkerPool(e.target.checked)} /> Worker/pool hız ayarlarını hedefe göre güncelle</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetApplyRunningCampaigns} onChange={(e) => setDailyTargetApplyRunningCampaigns(e.target.checked)} /> Mevcut çalışan kampanyalara uygula</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dailyTargetExcludeUnhealthy} onChange={(e) => setDailyTargetExcludeUnhealthy(e.target.checked)} /> Sagliksiz SMTP'leri dahil etme</label>
                <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" checked={dailyTargetEnforceSuppression} onChange={(e) => setDailyTargetEnforceSuppression(e.target.checked)} /> Suppression / unsubscribe kontrollerini zorunlu tut</label>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-indigo-100 md:grid-cols-4">
                <p>Gunluk hedef: {dailyTargetPreview.dailyTarget.toLocaleString()}</p>
                <p>Kullanilacak SMTP: {dailyTargetPreview.usableSmtpCount}</p>
                <p>Toplam hedef RPS: {dailyTargetPreview.globalRps.toFixed(2)}/s</p>
                <p>SMTP basi RPS: {dailyTargetPreview.perSmtpRps.toFixed(2)}/s</p>
                <p>SMTP basi gunluk limit: {dailyTargetPreview.perSmtpDailyCap.toLocaleString()}</p>
                <p>SMTP basi saatlik limit: {dailyTargetPreview.perSmtpHourlyCap.toLocaleString()}</p>
                <p>SMTP basi dakikalik limit: {dailyTargetPreview.perSmtpMinuteCap.toLocaleString()}</p>
                <p>Tahmini gunluk kapasite: {dailyTargetPreview.estimatedDailyCapacity.toLocaleString()}</p>
                <p className="col-span-2 md:col-span-4">Mod: {modeLabel(dailyTargetMode)}</p>
              </div>

              {dailyTargetPreview.warnings.length > 0 ? (
                <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                  {dailyTargetPreview.warnings.map((warning) => (
                    <p key={warning}>- {warning}</p>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setDailyTargetModalOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-300">
                  Iptal
                </button>
                <button
                  type="button"
                  onClick={() => void applyDailyTarget()}
                  disabled={actionLoading === "apply_daily_target"}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/50 bg-indigo-500/20 px-3 py-2 text-xs text-indigo-200 disabled:opacity-50"
                >
                  {actionLoading === "apply_daily_target" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Hedefi Uygula
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {showModal ? (
        <OverlayPortal active={showModal} lockScroll>
          <div className="fixed inset-0 z-40 bg-black/55 p-4 backdrop-blur-sm" onClick={() => setShowModal(false)}>
            <div className="mx-auto max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-zinc-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">{editingId ? "Edit SMTP" : "Add SMTP"}</p>
                <select
                  value={providerPreset}
                  onChange={(e) => {
                    const preset = e.target.value as ProviderPreset;
                    setProviderPreset(preset);
                    if (preset === "alibaba") {
                      applyAlibabaPreset();
                    }
                  }}
                  className="rounded-lg border border-border bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="alibaba">Alibaba DirectMail / Aliyun</option>
                  <option value="custom">Custom SMTP</option>
                </select>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {modalTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setModalTab(tab)}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${
                      modalTab === tab ? "border-indigo-400 bg-indigo-500/10 text-indigo-200" : "border-border text-zinc-300"
                    }`}
                  >
                    {tab === "connection" ? "Connection" : tab === "identity" ? "Identity" : tab === "rate" ? "Rate limits" : tab === "warmup" ? "Warmup" : "Advanced"}
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-border bg-zinc-900/40 p-3 text-xs text-zinc-300">
                <p>Planned SMTP count: {plannedSmtpCount}</p>
                <p>Calculated target RPS: {calculatedTargetRps} · Max RPS: {calculatedMaxRps}</p>
                <p>Estimated per SMTP daily capacity: {estimatedPerSmtpDaily.toLocaleString()}</p>
                <p className="mt-1 text-zinc-400">Calculated from Global Rate Planner and active SMTP pool.</p>
                <button type="button" onClick={applyCalculatedDefaults} className="mt-2 rounded border border-indigo-400/40 px-2 py-1 text-[11px] text-indigo-200">
                  Use calculated defaults
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {modalTab === "connection" ? (
                  <>
                    <Field label="SMTP Name" helper="Short internal display name"><TextInput value={form.name} onChange={(value) => setForm((s) => ({ ...s, name: value }))} /></Field>
                    <Field label="Provider Label" helper="alibaba/custom"><TextInput value={form.providerLabel} onChange={(value) => setForm((s) => ({ ...s, providerLabel: value }))} /></Field>
                    <Field label="Host" helper="Alibaba: smtpdm-ap-southeast-1.aliyuncs.com"><TextInput value={form.host} onChange={(value) => setForm((s) => ({ ...s, host: value }))} /></Field>
                    <Field label="Port" helper="SSL 465, TLS 587"><NumberInput value={form.port} onChange={(value) => setForm((s) => ({ ...s, port: value }))} /></Field>
                    <Field label="Security" helper="Port updates automatically by selection">
                      <SelectInput
                        value={form.encryption}
                        onChange={(value) => setForm((s) => ({ ...s, encryption: value, port: applySecurityDefaults(value, s.port) }))}
                        options={[{ value: "ssl", label: "SSL (465)" }, { value: "tls", label: "TLS/STARTTLS (587)" }, { value: "none", label: "None" }]}
                      />
                    </Field>
                    <Field label="Username" helper="Alibaba SMTP username"><TextInput value={form.username} onChange={(value) => setForm((s) => ({ ...s, username: value }))} /></Field>
                    <Field label="Password" helper="SMTP password"><TextInput type="password" value={form.password} onChange={(value) => setForm((s) => ({ ...s, password: value }))} /></Field>
                  </>
                ) : null}
                {modalTab === "identity" ? (
                  <>
                    <Field label="From Email" helper="Must be a verified sender"><TextInput value={form.fromEmail} onChange={(value) => setForm((s) => ({ ...s, fromEmail: value }))} /></Field>
                    <Field label="From Name" helper="Visible sender name"><TextInput value={form.fromName} onChange={(value) => setForm((s) => ({ ...s, fromName: value }))} /></Field>
                    <Field label="Tags" helper="Comma separated"><TextInput value={form.tags} onChange={(value) => setForm((s) => ({ ...s, tags: value }))} /></Field>
                    <Field label="Group" helper="Pool grouping label"><TextInput value={form.groupLabel} onChange={(value) => setForm((s) => ({ ...s, groupLabel: value }))} /></Field>
                  </>
                ) : null}
                {modalTab === "rate" ? (
                  <>
                    <Field label="Planned SMTP Count" helper="Used for calculation"><NumberInput value={form.plannedSmtpCount} onChange={(value) => setForm((s) => ({ ...s, plannedSmtpCount: Math.max(1, value) }))} /></Field>
                    <Field label="Target RPS" helper="Calculated from global planner"><NumberInput step="0.0001" value={form.targetRatePerSecond} onChange={(value) => setForm((s) => ({ ...s, targetRatePerSecond: value }))} /></Field>
                    <Field label="Max RPS" helper="Provider cap or override"><NumberInput step="0.0001" value={form.maxRatePerSecond} onChange={(value) => setForm((s) => ({ ...s, maxRatePerSecond: value }))} /></Field>
                    <Field label="Daily quota" helper="0 = unlimited"><NumberInput value={form.dailyCap} onChange={(value) => setForm((s) => ({ ...s, dailyCap: value }))} /></Field>
                    <Field label="Hourly quota" helper="0 = unlimited"><NumberInput value={form.hourlyCap} onChange={(value) => setForm((s) => ({ ...s, hourlyCap: value }))} /></Field>
                    <Field label="Minute quota" helper="0 = unlimited"><NumberInput value={form.minuteCap} onChange={(value) => setForm((s) => ({ ...s, minuteCap: value }))} /></Field>
                  </>
                ) : null}
                {modalTab === "warmup" ? (
                  <>
                    <Field label="Warmup enabled" helper="Alibaba default: true">
                      <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-900 px-3 py-2 text-xs">
                        <input type="checkbox" checked={form.warmupEnabled} onChange={(e) => setForm((s) => ({ ...s, warmupEnabled: e.target.checked }))} />
                        Enable warmup
                      </label>
                    </Field>
                    <Field label="Warmup start RPS" helper="Alibaba default: 1"><NumberInput step="0.01" value={form.warmupStartRps} onChange={(value) => setForm((s) => ({ ...s, warmupStartRps: value }))} /></Field>
                    <Field label="Warmup increment step" helper="Gradual step-up value"><NumberInput step="0.01" value={form.warmupIncrementStep} onChange={(value) => setForm((s) => ({ ...s, warmupIncrementStep: value }))} /></Field>
                    <Field label="Warmup max RPS" helper="Alibaba default: 15"><NumberInput step="0.01" value={form.warmupMaxRps} onChange={(value) => setForm((s) => ({ ...s, warmupMaxRps: value }))} /></Field>
                  </>
                ) : null}
                {modalTab === "advanced" ? (
                  <>
                    <Field label="Connection timeout (ms)" helper="Alibaba recommendation: 30000"><NumberInput value={form.connectionTimeout} onChange={(value) => setForm((s) => ({ ...s, connectionTimeout: value }))} /></Field>
                    <Field label="Socket timeout (ms)" helper="Alibaba recommendation: 60000"><NumberInput value={form.socketTimeout} onChange={(value) => setForm((s) => ({ ...s, socketTimeout: value }))} /></Field>
                  </>
                ) : null}
              </div>
              {isAlibabaPreset ? (
                <p className="mt-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-2 text-xs text-indigo-200">
                  Alibaba preset is active: host/port/security/warmup/timeouts were auto-applied. Enter real verified username/password/from email values.
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void saveAccount(false)} disabled={actionLoading === "save_account"} className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">
                  {actionLoading === "save_account" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                  Save SMTP
                </button>
                <button type="button" onClick={() => void saveAccount(true)} disabled={actionLoading === "save_account"} className="rounded-lg border border-indigo-500/50 px-3 py-2 text-sm text-indigo-200 disabled:opacity-50">
                  Save + Test
                </button>
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {testResultModal.open ? (
        <OverlayPortal active={testResultModal.open} lockScroll>
          <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm" onClick={() => setTestResultModal((s) => ({ ...s, open: false }))}>
            <div className="relative z-[60] mx-auto w-full max-w-lg rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Test Connection Result · {testResultModal.accountName}</p>
                <StatusBadge label={testResultModal.connected ? "connected" : testResultModal.kind} tone={testResultModal.connected ? "success" : "danger"} />
              </div>
              <p className="text-sm text-zinc-200">{testResultModal.message}</p>
              {testResultModal.recommendation ? (
                <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">{testResultModal.recommendation}</p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={() => setTestResultModal((s) => ({ ...s, open: false }))} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200">
                  Close
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {showBulkAlibabaModal ? (
        <OverlayPortal active={showBulkAlibabaModal} lockScroll>
          <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowBulkAlibabaModal(false)}>
            <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-zinc-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Bulk Add Alibaba SMTPs</p>
                <button
                  type="button"
                  onClick={() => setShowBulkAlibabaModal(false)}
                  className="rounded border border-border px-2 py-1 text-xs text-zinc-300"
                >
                  Close
                </button>
              </div>
              <textarea
                rows={10}
                value={bulkAlibabaLines}
                onChange={(e) => setBulkAlibabaLines(e.target.value)}
                placeholder={`email:password\nmarketing@example.com:SMTP_PASSWORD\nsender@example.com:SMTP_PASSWORD`}
                className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100"
              />
              {bulkAlibabaPreview.rows.length > 0 ? (
                <div className="mt-3 rounded-lg border border-border bg-zinc-900/40 p-3">
                  <p className="mb-2 text-[11px] text-zinc-500">
                    Preview (passwords never shown) · valid {bulkAlibabaPreview.summary.valid} · invalid{" "}
                    {bulkAlibabaPreview.summary.invalid} · duplicate lines {bulkAlibabaPreview.summary.duplicate}
                  </p>
                  <div className="max-h-48 overflow-auto rounded border border-border">
                    <table className="w-full border-collapse text-left text-[11px] text-zinc-300">
                      <thead className="sticky top-0 bg-zinc-900/90 text-zinc-500">
                        <tr>
                          <th className="border-b border-border px-2 py-1 font-medium">#</th>
                          <th className="border-b border-border px-2 py-1 font-medium">email</th>
                          <th className="border-b border-border px-2 py-1 font-medium">username</th>
                          <th className="border-b border-border px-2 py-1 font-medium">fromEmail</th>
                          <th className="border-b border-border px-2 py-1 font-medium">status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkAlibabaPreview.rows.map((row) => (
                          <tr key={`${row.lineNumber}-${row.email}-${row.status}`} className="border-b border-border/60 last:border-0">
                            <td className="px-2 py-1 text-zinc-500">{row.lineNumber}</td>
                            <td className="px-2 py-1 font-mono text-[10px]">{row.email}</td>
                            <td className="px-2 py-1 font-mono text-[10px]">{row.username}</td>
                            <td className="px-2 py-1 font-mono text-[10px]">{row.fromEmail}</td>
                            <td className="px-2 py-1">
                              <span
                                className={
                                  row.status === "ok"
                                    ? "text-emerald-400"
                                    : row.status === "duplicate"
                                      ? "text-amber-300"
                                      : "text-red-400"
                                }
                              >
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={bulkAlibabaUpdateExisting}
                  onChange={(e) => setBulkAlibabaUpdateExisting(e.target.checked)}
                />
                Update existing SMTPs
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={actionLoading === "bulk_alibaba_import"}
                  onClick={() => void submitBulkAlibabaImport()}
                  className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {actionLoading === "bulk_alibaba_import" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkAlibabaLines("");
                    setBulkAlibabaResult(null);
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-300"
                >
                  Clear
                </button>
              </div>
              {bulkAlibabaResult ? (
                <div className="mt-3 rounded-lg border border-border bg-zinc-900/40 p-3 text-xs text-zinc-300">
                  <p>scanned: {bulkAlibabaResult.scanned}</p>
                  <p>added: {bulkAlibabaResult.added}</p>
                  <p>updated: {bulkAlibabaResult.updated}</p>
                  <p>skipped duplicate: {bulkAlibabaResult.skippedDuplicate}</p>
                  <p>invalid: {bulkAlibabaResult.invalid}</p>
                  {bulkAlibabaResult.errors.length > 0 ? (
                    <div className="mt-2 max-h-36 overflow-auto rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                      {bulkAlibabaResult.errors.slice(0, 50).map((item) => (
                        <p key={item}>- {item}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {bulkTestModalOpen ? (
        <OverlayPortal active={bulkTestModalOpen} lockScroll>
          <div className="fixed inset-0 z-[56] bg-black/70 p-4 backdrop-blur-sm" onClick={() => setBulkTestModalOpen(false)}>
            <div className="mx-auto mt-8 w-full max-w-5xl rounded-2xl border border-border bg-zinc-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-white">Toplu SMTP Testi</p>
              <p className="mt-1 text-xs text-zinc-400">Seçili veya filtrelenmiş SMTP hesaplarının bağlantı ve gönderim testini çalıştırın.</p>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                <Field label="Kapsam">
                  <SelectInput
                    value={bulkTestScope}
                    onChange={(value) => setBulkTestScope(value as BulkTestScope)}
                    options={[
                      { value: "all_active", label: "Tüm aktif SMTP’ler" },
                      { value: "healthy", label: "Sadece sağlıklı SMTP’ler" },
                      { value: "throttled", label: "Sadece sınırlandırılmış SMTP’ler" },
                      { value: "error", label: "Sadece hatalı SMTP’ler" },
                      { value: "selected", label: "Seçili SMTP’ler" },
                      { value: "filtered", label: "Mevcut filtre sonucu" }
                    ]}
                  />
                </Field>
                <Field label="Test tipi">
                  <SelectInput
                    value={bulkTestType}
                    onChange={(value) => setBulkTestType(value as BulkTestType)}
                    options={[
                      { value: "connection", label: "Bağlantı testi" },
                      { value: "send_test_email", label: "Test maili gönder" },
                      { value: "both", label: "Bağlantı + test maili" }
                    ]}
                  />
                </Field>
                <Field label="Test alıcı e-postası" helper="Test maili için zorunlu">
                  <TextInput value={bulkTestRecipient} onChange={setBulkTestRecipient} type="email" />
                </Field>
                <Field label="Eşzamanlı test sayısı">
                  <SelectInput
                    value={String(bulkTestConcurrency)}
                    onChange={(value) => setBulkTestConcurrency(Math.max(1, Math.min(20, Number(value))))}
                    options={[
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                      { value: "5", label: "5" },
                      { value: "10", label: "10" },
                      { value: "20", label: "20" }
                    ]}
                  />
                </Field>
                <Field label="Timeout" helper="saniye">
                  <NumberInput value={bulkTestTimeoutSeconds} onChange={(value) => setBulkTestTimeoutSeconds(Math.max(5, Math.min(120, value)))} />
                </Field>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-300 md:grid-cols-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={bulkTestUpdateHealth} onChange={(e) => setBulkTestUpdateHealth(e.target.checked)} />
                  Test sonrası sağlık durumunu güncelle
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={bulkTestClearThrottleOnSuccess}
                    onChange={(e) => setBulkTestClearThrottleOnSuccess(e.target.checked)}
                  />
                  Başarılı olanların throttle durumunu temizle
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={bulkTestNoAutoDisable} onChange={(e) => setBulkTestNoAutoDisable(e.target.checked)} />
                  Hatalıları pasif yapma, sadece durumunu güncelle
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={bulkTestOnlyActive} onChange={(e) => setBulkTestOnlyActive(e.target.checked)} />
                  Sadece aktif SMTP’leri test et
                </label>
              </div>

              {bulkTestScope === "selected" ? (
                <p className="mt-2 text-xs text-indigo-200">{selectedCount} SMTP seçildi</p>
              ) : null}
              {bulkTestScope === "filtered" ? (
                <p className="mt-2 text-xs text-indigo-200">Mevcut filtre sonucu: {filteredAccounts.length.toLocaleString()} SMTP</p>
              ) : null}

              <div className="mt-3 rounded-xl border border-border bg-zinc-900/30 p-3">
                <p className="text-xs text-zinc-400">
                  {bulkTestProcessed} / {bulkTestTotal} test edildi
                </p>
                <div className="mt-2 h-2 w-full rounded bg-zinc-800">
                  <div
                    className="h-2 rounded bg-indigo-500 transition-all"
                    style={{ width: `${bulkTestTotal > 0 ? Math.min(100, Math.round((bulkTestProcessed / bulkTestTotal) * 100)) : 0}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">Başarılı: {bulkTestSummary.success}</div>
                  <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200">Başarısız: {bulkTestSummary.failed}</div>
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">Atlandı: {bulkTestSummary.skipped}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBulkTestShowOnlyFailed((prev) => !prev)}
                  className="rounded-lg border border-rose-400/40 px-3 py-2 text-xs text-rose-200"
                >
                  Başarısızları filtrele
                </button>
                <button type="button" onClick={() => downloadBulkTestCsv()} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200">
                  Sonuçları CSV indir
                </button>
              </div>

              <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-left text-[11px] text-zinc-300">
                  <thead className="sticky top-0 bg-zinc-900/95 text-zinc-500">
                    <tr>
                      <th className="border-b border-border px-2 py-1">SMTP</th>
                      <th className="border-b border-border px-2 py-1">Provider</th>
                      <th className="border-b border-border px-2 py-1">Test tipi</th>
                      <th className="border-b border-border px-2 py-1">Durum</th>
                      <th className="border-b border-border px-2 py-1">Süre</th>
                      <th className="border-b border-border px-2 py-1">Hata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkTestVisibleResults.map((item) => (
                      <tr key={`${item.smtpId}-${item.testedAt}-${item.status}`} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-1 font-mono text-[10px]">{item.fromEmail}</td>
                        <td className="px-2 py-1">{item.provider}</td>
                        <td className="px-2 py-1">
                          {item.testType === "connection" ? "Bağlantı testi" : item.testType === "send_test_email" ? "Test maili gönder" : "Bağlantı + test maili"}
                        </td>
                        <td className="px-2 py-1">{item.status === "success" ? "Başarılı" : item.status === "failed" ? "Başarısız" : "Atlandı"}</td>
                        <td className="px-2 py-1">{item.latencyMs ? `${item.latencyMs} ms` : "-"}</td>
                        <td className="px-2 py-1">{item.error ?? "-"}</td>
                      </tr>
                    ))}
                    {bulkTestVisibleResults.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-3 text-center text-zinc-500">
                          Henüz sonuç yok.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setBulkTestModalOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-300">
                  {bulkTestStatus === "running" ? "Kapat" : "İptal"}
                </button>
                <button
                  type="button"
                  onClick={() => void startBulkSmtpTest()}
                  disabled={actionLoading === "bulk_test" || bulkTestStatus === "running"}
                  className="rounded-lg border border-indigo-500/50 bg-indigo-500/20 px-3 py-2 text-xs text-indigo-100 disabled:opacity-50"
                >
                  {actionLoading === "bulk_test" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                  Testi Başlat
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {bulkWarmupModalOpen ? (
        <OverlayPortal active={bulkWarmupModalOpen} lockScroll>
          <div className="fixed inset-0 z-[56] bg-black/70 p-4 backdrop-blur-sm" onClick={() => setBulkWarmupModalOpen(false)}>
            <div className="mx-auto mt-8 w-full max-w-3xl rounded-2xl border border-border bg-zinc-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-white">Toplu SMTP Rate ve Warmup Ayarlari</p>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <Field label="Kapsam" helper="Hangi SMTP hesaplari guncellenecek">
                  <SelectInput
                    value={bulkScope}
                    onChange={(value) => setBulkScope(value as BulkScope)}
                    options={[
                      { value: "all_active", label: "Tum aktif SMTP'ler" },
                      { value: "selected", label: "Sadece secili SMTP'ler" },
                      { value: "healthy", label: "Sadece saglikli SMTP'ler" },
                      { value: "error", label: "Sadece hata durumundaki SMTP'ler" }
                    ]}
                  />
                </Field>
                <Field label="Preset" helper="Hazir hiz/warmup profili">
                  <SelectInput
                    value={bulkPreset}
                    onChange={(value) => setBulkPreset(value as BulkPreset)}
                    options={[
                      { value: "safe", label: "Guvenli" },
                      { value: "balanced", label: "Dengeli" },
                      { value: "fast", label: "Hizli" },
                      { value: "aggressive", label: "Agresif" },
                      { value: "custom", label: "Ozel" },
                      { value: "daily_target", label: "Global hedefe gore dagit" }
                    ]}
                  />
                </Field>
              </div>

              {bulkScope === "selected" ? (
                <p className="mt-2 text-xs text-amber-200">Secili SMTP sayisi: {selectedCount}. (Liste gorunumunde secim yapabilirsiniz)</p>
              ) : null}

              {bulkPreset === "daily_target" ? (
                <div className="mt-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
                  <Field label="Gunluk hedef (dailyTarget)" helper="Ornek: 1000000">
                    <NumberInput value={bulkDailyTarget} onChange={(value) => setBulkDailyTarget(Math.max(1, value))} />
                  </Field>
                  {bulkDistributionPreview ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-indigo-100">
                      <p>Toplam SMTP: {bulkDistributionPreview.totalSmtp}</p>
                      <p>Kullanilacak SMTP: {bulkDistributionPreview.usableSmtpCount}</p>
                      <p>Gunluk hedef: {bulkDistributionPreview.dailyTarget.toLocaleString()}</p>
                      <p>SMTP basi gunluk limit: {bulkDistributionPreview.perSmtpDailyCap.toLocaleString()}</p>
                      <p>SMTP basi RPS: {bulkDistributionPreview.perSmtpRps}</p>
                      <p>Tahmini toplam RPS: {bulkDistributionPreview.estimatedTotalRps}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-amber-200">Bu kapsamda dagitim yapilacak uygun SMTP bulunamadi.</p>
                  )}
                </div>
              ) : null}

              {bulkPreset !== "daily_target" ? (
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Field label="Target RPS" helper="SMTP basi hedef">
                    <NumberInput step="0.01" value={bulkWarmupValues.targetRatePerSecond} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, targetRatePerSecond: value }))} />
                  </Field>
                  <Field label="Max RPS" helper="SMTP basi ust sinir">
                    <NumberInput step="0.01" value={bulkWarmupValues.maxRatePerSecond} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, maxRatePerSecond: value }))} />
                  </Field>
                  <Field label="Warmup Baslangic RPS" helper="warmupStartRps">
                    <NumberInput step="0.01" value={bulkWarmupValues.warmupStartRps} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, warmupStartRps: value }))} />
                  </Field>
                  <Field label="Warmup Artis Adimi" helper="warmupIncrementStep">
                    <NumberInput step="0.01" value={bulkWarmupValues.warmupIncrementStep} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, warmupIncrementStep: value }))} />
                  </Field>
                  <Field label="Warmup Max RPS" helper="warmupMaxRps">
                    <NumberInput step="0.01" value={bulkWarmupValues.warmupMaxRps} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, warmupMaxRps: value }))} />
                  </Field>
                  <Field label="Warmup Aktif" helper="Tum secili SMTP'lerde warmup ac/kapat">
                    <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-900 px-3 py-2 text-xs">
                      <input type="checkbox" checked={bulkWarmupValues.warmupEnabled} onChange={(e) => setBulkWarmupValues((s) => ({ ...s, warmupEnabled: e.target.checked }))} />
                      Warmup aktif
                    </label>
                  </Field>
                </div>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                <Field label="Gunluk limit / SMTP" helper="0 = degistirme">
                  <NumberInput value={bulkWarmupValues.dailyCap} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, dailyCap: value }))} />
                </Field>
                <Field label="Saatlik limit / SMTP" helper="0 = degistirme">
                  <NumberInput value={bulkWarmupValues.hourlyCap} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, hourlyCap: value }))} />
                </Field>
                <Field label="Dakikalik limit / SMTP" helper="0 = degistirme">
                  <NumberInput value={bulkWarmupValues.minuteCap} onChange={(value) => setBulkWarmupValues((s) => ({ ...s, minuteCap: value }))} />
                </Field>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-300 md:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={bulkWarmupValues.resetThrottle} onChange={(e) => setBulkWarmupValues((s) => ({ ...s, resetThrottle: e.target.checked }))} /> Throttle durumunu sifirla</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={bulkWarmupValues.clearCooldown} onChange={(e) => setBulkWarmupValues((s) => ({ ...s, clearCooldown: e.target.checked }))} /> Cooldown temizle</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={bulkWarmupValues.clearLastError} onChange={(e) => setBulkWarmupValues((s) => ({ ...s, clearLastError: e.target.checked }))} /> Son hata bilgisini temizle</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={bulkWarmupValues.onlyActive} onChange={(e) => setBulkWarmupValues((s) => ({ ...s, onlyActive: e.target.checked }))} /> Sadece aktif SMTP'lere uygula</label>
              </div>

              {bulkApplyPreview ? (
                <p className="mt-2 text-xs text-indigo-200">
                  Son dagitim onizlemesi: Gunluk {bulkApplyPreview.dailyTarget.toLocaleString()} · SMTP basi {bulkApplyPreview.perSmtpDailyCap.toLocaleString()} · RPS {bulkApplyPreview.perSmtpRps}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setBulkWarmupModalOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-300">
                  Iptal
                </button>
                <button type="button" onClick={() => void applyBulkRateWarmup()} disabled={actionLoading === "bulk_rate_warmup"} className="rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50">
                  {actionLoading === "bulk_rate_warmup" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                  Uygula
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {bulkResetModalOpen ? (
        <OverlayPortal active={bulkResetModalOpen} lockScroll>
          <div className="fixed inset-0 z-[56] bg-black/70 p-4 backdrop-blur-sm" onClick={() => setBulkResetModalOpen(false)}>
            <div className="mx-auto mt-16 w-full max-w-lg rounded-2xl border border-border bg-zinc-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-white">Rate Limit / Throttle Temizle</p>
              <div className="mt-3">
                <Field label="Kapsam" helper="Temizlenecek SMTP grubu">
                  <SelectInput
                    value={bulkScope}
                    onChange={(value) => setBulkScope(value as BulkScope)}
                    options={[
                      { value: "all_active", label: "Tum aktif SMTP'ler" },
                      { value: "selected", label: "Sadece secili SMTP'ler" },
                      { value: "healthy", label: "Sadece saglikli SMTP'ler" },
                      { value: "error", label: "Sadece hata durumundaki SMTP'ler" }
                    ]}
                  />
                </Field>
              </div>
              <div className="mt-2 space-y-2 text-xs text-zinc-300">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={bulkResetSetHealthy} onChange={(e) => setBulkResetSetHealthy(e.target.checked)} />
                  Health durumunu da healthy yap
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={bulkResetIncludeAuthErrors} onChange={(e) => setBulkResetIncludeAuthErrors(e.target.checked)} />
                  Auth hatalarini da temizle
                </label>
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                Varsayilan olarak auth hatalari korunur. Bu islem isThrottled/throttleReason/cooldownUntil/lastError alanlarini temizler.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setBulkResetModalOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-300">
                  Iptal
                </button>
                <button type="button" onClick={() => void runBulkResetThrottle()} disabled={actionLoading === "bulk_reset_throttle"} className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-xs text-amber-200 disabled:opacity-50">
                  {actionLoading === "bulk_reset_throttle" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                  Temizle
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {plannerModalOpen ? (
        <OverlayPortal active={plannerModalOpen} lockScroll>
          <div
            className="fixed inset-0 z-[55] bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => {
              if (actionLoading !== "apply_rate_planner") {
                setPlannerModalOpen(false);
              }
            }}
          >
            <div
              className="mx-auto mt-16 w-full max-w-lg rounded-2xl border border-emerald-500/40 bg-zinc-950 p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-emerald-200">
                This will update rate limits for {plannerPreview.usableCount} SMTP accounts.
              </p>
              <p className="mt-2 text-xs text-zinc-400">
                Inactive and soft-deleted SMTP accounts are always excluded.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-200">
                <p>Daily target: {plannerPreview.dailyTarget.toLocaleString()}</p>
                <p>Total usable SMTPs: {plannerPreview.usableCount}</p>
                <p>Per SMTP daily cap: {plannerPreview.perSmtpDailyCap.toLocaleString()}</p>
                <p>Per SMTP RPS: {plannerPreview.perSmtpRps.toLocaleString()}</p>
                <p>Global RPS: {plannerPreview.globalRps.toLocaleString()}</p>
                <p>Per SMTP hourly/minute: {plannerPreview.perSmtpHourlyCap}/{plannerPreview.perSmtpMinuteCap}</p>
              </div>
              <div className="mt-3 space-y-2 rounded-lg border border-border bg-zinc-900/50 p-3 text-xs text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={plannerIncludeThrottled}
                    onChange={(e) => setPlannerIncludeThrottled(e.target.checked)}
                  />
                  Include throttled SMTPs
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={plannerIncludeUnhealthy}
                    onChange={(e) => setPlannerIncludeUnhealthy(e.target.checked)}
                  />
                  Include unhealthy SMTPs
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPlannerModalOpen(false)}
                  disabled={actionLoading === "apply_rate_planner"}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-300 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void applyPlannerToAllSmtps()}
                  disabled={actionLoading === "apply_rate_planner" || plannerPreview.usableCount === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50"
                >
                  {actionLoading === "apply_rate_planner" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Apply planner
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}

      {bulkDeleteModalOpen ? (
        <OverlayPortal active={bulkDeleteModalOpen} lockScroll>
          <div
            className="fixed inset-0 z-[55] bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => {
              if (actionLoading !== "bulk_delete") {
                setBulkDeleteModalOpen(false);
                setBulkDeleteTyped("");
              }
            }}
          >
            <div
              className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-rose-500/40 bg-zinc-950 p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-rose-200">Delete {selectedCount} SMTP account(s)?</p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                Selected accounts will be archived (soft delete) and removed from this list. SMTP passwords are never sent to the browser. Type{" "}
                <span className="font-mono text-zinc-200">DELETE</span> to confirm.
              </p>
              {selectedCount > 0 && selectedCount === accounts.length ? (
                <p className="mt-2 text-xs text-amber-300">You have selected all {accounts.length} visible account(s).</p>
              ) : null}
              <input
                value={bulkDeleteTyped}
                onChange={(e) => setBulkDeleteTyped(e.target.value)}
                className="mt-3 w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                placeholder="Type DELETE"
                autoComplete="off"
                autoFocus
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBulkDeleteModalOpen(false);
                    setBulkDeleteTyped("");
                  }}
                  disabled={actionLoading === "bulk_delete"}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-300 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void executeBulkDelete()}
                  disabled={actionLoading === "bulk_delete" || bulkDeleteTyped !== "DELETE" || selectedCount === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/50 bg-rose-500/20 px-3 py-2 text-xs text-rose-200 disabled:opacity-50"
                >
                  {actionLoading === "bulk_delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Confirm delete
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}
    </div>
  );
}

function Field({ label, children, helper }: { label: string; children: React.ReactNode; helper?: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-zinc-500">{label}</p>
      {children}
      {helper ? <p className="mt-1 text-[11px] text-zinc-500">{helper}</p> : null}
    </div>
  );
}

function SettingField({
  label,
  helper,
  tooltip,
  badge,
  children
}: {
  label: string;
  helper: string;
  tooltip?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-zinc-900/30 p-3">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[11px] text-zinc-400">{label}</p>
        {badge ? <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">{badge}</span> : null}
        {tooltip ? (
          <span title={tooltip} className="inline-flex items-center text-zinc-500 hover:text-zinc-300">
            <Info className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      {children}
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{helper}</p>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  type = "text"
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-400/50"
    />
  );
}

function NumberInput({
  value,
  onChange,
  step = "1"
}: {
  value: number;
  onChange: (value: number) => void;
  step?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value || 0))}
      className="w-full rounded-lg border border-border bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-400/50"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-400/50"
    >
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
  tone = "default"
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : tone === "danger"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-border bg-gradient-to-br from-zinc-900/90 to-zinc-950 text-zinc-100";
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide">{title}</p>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-xl font-semibold">{Number.isFinite(value) ? value.toLocaleString() : "-"}</p>
    </div>
  );
}

function RateStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="font-semibold">{Number.isFinite(value) ? value.toLocaleString() : "-"}</p>
    </div>
  );
}
