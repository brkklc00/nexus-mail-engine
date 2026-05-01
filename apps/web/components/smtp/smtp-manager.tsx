"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Loader2, MailX, PlayCircle, PlugZap, RefreshCw, Save, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { OverlayPortal } from "@/components/ui/overlay-portal";

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

type PoolSettings = {
  sendingMode: "single" | "pool";
  useAllActiveByDefault: boolean;
  rotateEvery: number;
  parallelSmtpLanes: number;
  perSmtpConcurrency: number;
  skipThrottled: boolean;
  skipUnhealthy: boolean;
  fallbackToNextOnError: boolean;
  retryCount: number;
  retryDelayMs: number;
  cooldownAfterErrorSec: number;
};

const defaultPoolSettings: PoolSettings = {
  sendingMode: "pool",
  useAllActiveByDefault: true,
  rotateEvery: 500,
  parallelSmtpLanes: 2,
  perSmtpConcurrency: 1,
  skipThrottled: true,
  skipUnhealthy: true,
  fallbackToNextOnError: true,
  retryCount: 5,
  retryDelayMs: 2000,
  cooldownAfterErrorSec: 60
};

const dailyPresets = [5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000, 25000000, 50000000];
const modalTabs = ["connection", "identity", "rate", "warmup", "advanced"] as const;
type ModalTab = (typeof modalTabs)[number];
type ProviderPreset = "alibaba" | "custom";

export function SmtpManager({
  initialAccounts,
  initialMetrics: _initialMetrics,
  initialPoolSettings
}: {
  initialAccounts: Account[];
  initialMetrics: Metrics;
  initialPoolSettings: Partial<PoolSettings> | null;
}) {
  const baselineMetrics = _initialMetrics;
  const toast = useToast();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [poolSettings, setPoolSettings] = useState<PoolSettings>({ ...defaultPoolSettings, ...(initialPoolSettings ?? {}) });
  const [poolSaving, setPoolSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
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
  const [rateTargetDaily, setRateTargetDaily] = useState(100000);
  const [rateMode, setRateMode] = useState<"automatic" | "manual">("automatic");
  const [manualRps, setManualRps] = useState(1);
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

  const warmupHelper = useMemo(() => {
    if (poolSettings.rotateEvery <= 250) return "100-250 is recommended for warmup SMTP accounts.";
    if (poolSettings.rotateEvery <= 700) return "Around 500 is ideal for regular SMTP distribution.";
    return "1000-2500 is suitable for high-trust SMTP accounts.";
  }, [poolSettings.rotateEvery]);
  const metrics = useMemo(() => {
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
  }, [accounts, baselineMetrics.totalFailedToday, baselineMetrics.totalSentToday]);

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
      const response = await fetch("/api/smtp/pool-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(poolSettings)
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Pool settings could not be saved");
      }
      toast.success("Pool settings saved");
    } catch (error) {
      toast.error("Pool settings could not be saved", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setPoolSaving(false);
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

  async function testConnectionById(accountId: string, accountName: string) {
    setActionLoading(`test:${accountId}`);
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
      toast.success("SMTP connection test succeeded");
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === accountId ? { ...item, healthStatus: "healthy", lastError: null, lastTestAt: new Date().toISOString() } : item
        )
      );
      setTestResultModal({
        open: true,
        accountName,
        connected: true,
        kind: payload.result?.kind ?? "connected",
        message: payload.result?.message ?? "SMTP connection successful."
      });
      setShowModal(false);
      resetForm();
      setActionLoading(null);
      return;
    }
    toast.error("SMTP connection test failed", payload.error ?? "Connection could not be established.");
    setAccounts((prev) =>
      prev.map((item) =>
        item.id === accountId
          ? { ...item, healthStatus: "error", lastError: payload.error ?? "Connection failed", lastTestAt: new Date().toISOString() }
          : item
      )
    );
    setTestResultModal({
      open: true,
      accountName,
      connected: false,
      kind: payload.errorKind ?? "unknown",
      message: payload.error ?? "Connection failed",
      recommendation: payload.recommendation
    });
    setActionLoading(null);
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

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total SMTP" value={metrics.totalSmtpAccounts} icon={BarChart3} />
        <MetricCard title="Active SMTP" value={metrics.activeSmtpAccounts} icon={CheckCircle2} tone="success" />
        <MetricCard title="Healthy SMTP" value={metrics.healthySmtpAccounts} icon={PlayCircle} tone="success" />
        <MetricCard title="Throttled SMTP" value={metrics.throttledSmtpAccounts} icon={ShieldAlert} tone="warning" />
        <MetricCard title="Sent Today" value={metrics.totalSentToday} icon={CheckCircle2} />
        <MetricCard title="Failed Today" value={metrics.totalFailedToday} icon={MailX} tone="danger" />
        <MetricCard title="Effective Total RPS" value={metrics.effectiveTotalRps} icon={RefreshCw} />
        <MetricCard title="Estimated Daily Capacity" value={metrics.estimatedDailyCapacity} icon={BarChart3} />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">SMTP Pool Settings</p>
          <button type="button" onClick={() => void savePoolSettings()} disabled={poolSaving} className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200">
            {poolSaving ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : <Save className="inline h-3.5 w-3.5" />} Save Pool Settings
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <select value={poolSettings.sendingMode} onChange={(e) => setPoolSettings((s) => ({ ...s, sendingMode: e.target.value as "single" | "pool" }))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
            <option value="single">Sending mode: single SMTP</option>
            <option value="pool">Sending mode: SMTP pool</option>
          </select>
          <input type="number" value={poolSettings.rotateEvery} onChange={(e) => setPoolSettings((s) => ({ ...s, rotateEvery: Number(e.target.value || 500) }))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          <input type="number" value={poolSettings.parallelSmtpLanes} onChange={(e) => setPoolSettings((s) => ({ ...s, parallelSmtpLanes: Number(e.target.value || 1) }))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          <input type="number" value={poolSettings.perSmtpConcurrency} onChange={(e) => setPoolSettings((s) => ({ ...s, perSmtpConcurrency: Number(e.target.value || 1) }))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs"><input type="checkbox" checked={poolSettings.useAllActiveByDefault} onChange={(e) => setPoolSettings((s) => ({ ...s, useAllActiveByDefault: e.target.checked }))} />Use all active SMTPs</label>
          <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs"><input type="checkbox" checked={poolSettings.skipThrottled} onChange={(e) => setPoolSettings((s) => ({ ...s, skipThrottled: e.target.checked }))} />Skip throttled SMTPs</label>
          <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs"><input type="checkbox" checked={poolSettings.skipUnhealthy} onChange={(e) => setPoolSettings((s) => ({ ...s, skipUnhealthy: e.target.checked }))} />Skip unhealthy SMTPs</label>
          <label className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-3 py-2 text-xs"><input type="checkbox" checked={poolSettings.fallbackToNextOnError} onChange={(e) => setPoolSettings((s) => ({ ...s, fallbackToNextOnError: e.target.checked }))} />Fallback to next SMTP on error</label>
          <input type="number" value={poolSettings.retryCount} onChange={(e) => setPoolSettings((s) => ({ ...s, retryCount: Number(e.target.value || 0) }))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          <input type="number" value={poolSettings.retryDelayMs} onChange={(e) => setPoolSettings((s) => ({ ...s, retryDelayMs: Number(e.target.value || 0) }))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
          <input type="number" value={poolSettings.cooldownAfterErrorSec} onChange={(e) => setPoolSettings((s) => ({ ...s, cooldownAfterErrorSec: Number(e.target.value || 0) }))} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
        </div>
        <p className="mt-2 text-xs text-zinc-400">Rotate every N recipients per SMTP. Lower = better distribution, higher = less switching. {warmupHelper}</p>
      </section>

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
      </section>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">SMTP Accounts</p>
          <button type="button" onClick={() => { resetForm(); setShowModal(true); }} className="rounded-lg bg-accent px-3 py-2 text-xs text-white">
            Add SMTP
          </button>
        </div>
        {accounts.length === 0 ? (
          <EmptyState icon="server" title="No SMTP accounts" description="Create your first account with Add SMTP." />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {accounts.map((account) => (
          <article key={account.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-white">{account.name}</p>
                <p className="text-xs text-zinc-400">
                  {account.fromEmail} · {account.providerLabel ?? "custom"} · {account.host}:{account.port} · {account.encryption.toUpperCase()}
                </p>
              </div>
              <StatusBadge
                label={!account.isActive ? "disabled" : account.isThrottled ? "throttled" : account.healthStatus === "error" ? "error" : "healthy"}
                tone={!account.isActive ? "muted" : account.isThrottled ? "warning" : account.healthStatus === "error" ? "danger" : "success"}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-300">
              <p>Target/Max RPS: {account.targetRatePerSecond}/{account.maxRatePerSecond ?? "-"}</p>
              <p>Warmup tier: {account.warmupTier ?? "-"}</p>
              <p>Sent/Failed today: {account.sentToday}/{account.failedToday}</p>
              <p>Last test: {account.lastTestAt ? new Date(account.lastTestAt).toLocaleString() : "-"}</p>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Last error: {account.lastError ?? "-"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
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
              <p className="mt-2 flex items-center gap-1 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                Cooldown until {new Date(account.cooldownUntil).toLocaleTimeString()}
              </p>
            ) : null}
          </article>
        ))}
      </div>

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
