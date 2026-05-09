import { prisma } from "@nexus/db";
import { calculateEffectiveRate, isAlibabaProvider, type WarmupTier } from "@nexus/rate-control";

const DEFAULT_ALIBABA_LADDER: WarmupTier[] = [
  { name: "0-500", minDelivered: 0, ratePerSecond: 1 },
  { name: "501-2k", minDelivered: 501, ratePerSecond: 2 },
  { name: "2k-5k", minDelivered: 2001, ratePerSecond: 3 },
  { name: "5k-10k", minDelivered: 5001, ratePerSecond: 5 },
  { name: "10k-25k", minDelivered: 10001, ratePerSecond: 8 },
  { name: "25k-50k", minDelivered: 25001, ratePerSecond: 10 },
  { name: "50k+", minDelivered: 50001, ratePerSecond: 15 }
];
const WORKER_SETTINGS_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_SETTINGS_CACHE_MS ?? 30_000));
const ALIBABA_PROVIDER_SAFE_MAX_RPS = Math.max(1, Number(process.env.ALIBABA_PROVIDER_SAFE_MAX_RPS ?? 15));
const SMTP_DEFAULT_PROVIDER_SAFE_MAX_RPS = Math.max(1, Number(process.env.SMTP_DEFAULT_PROVIDER_SAFE_MAX_RPS ?? 5));

let cachedDailyTargetSummary: { value: any; expiresAt: number } | null = null;
let lastSummaryBustReadAt = 0;
let lastSeenSummaryBustTs = 0;

function smtpLooksAlibaba(smtp: { host: string; providerLabel?: string | null }) {
  if (isAlibabaProvider(smtp.host)) return true;
  const p = String(smtp.providerLabel ?? "").toLowerCase();
  return p.includes("alibaba") || p.includes("aliyun") || smtp.host.toLowerCase().includes("smtpdm");
}

function isAuthFailedSignal(input: { healthStatus?: string | null; throttleReason?: string | null; lastError?: string | null }) {
  const raw = `${input.healthStatus ?? ""} ${input.throttleReason ?? ""} ${input.lastError ?? ""}`.toLowerCase();
  return raw.includes("auth_failed") || raw.includes("authentication") || raw.includes("invalid credentials");
}

function resolveWarmupPolicyFromSummary(summary: any): string {
  const fromSummary = String(summary?.warmupPolicy ?? "").trim().toLowerCase();
  if (fromSummary) return fromSummary;
  return String(process.env.SMTP_WARMUP_POLICY ?? "").trim().toLowerCase();
}

function isForceTargetPolicy(summary: any) {
  return resolveWarmupPolicyFromSummary(summary) === "force_target";
}

async function maybeInvalidateDailyTargetSummaryCache() {
  const now = Date.now();
  if (now - lastSummaryBustReadAt < 2_000) return;
  lastSummaryBustReadAt = now;
  const bust = await prisma.appSetting.findUnique({ where: { key: "smtp_runtime_cache_bust" } }).catch(() => null);
  const ts = Number(((bust?.value as any) ?? {}).ts ?? 0);
  if (Number.isFinite(ts) && ts > lastSeenSummaryBustTs) {
    lastSeenSummaryBustTs = ts;
    cachedDailyTargetSummary = null;
  }
}

async function getDailyTargetSummaryCached() {
  await maybeInvalidateDailyTargetSummaryCache();
  const now = Date.now();
  if (cachedDailyTargetSummary && cachedDailyTargetSummary.expiresAt > now) {
    return cachedDailyTargetSummary.value;
  }
  const [row, poolRow] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: "smtp_daily_target_summary" } }).catch(() => null),
    prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } }).catch(() => null)
  ]);
  const rawSummary = ((row?.value as any) ?? {}) as Record<string, unknown>;
  const pool = ((poolRow?.value as any) ?? {}) as { warmupPolicy?: string; targetPerSmtpRps?: number };
  const value = {
    ...rawSummary,
    warmupPolicy: (rawSummary.warmupPolicy as string | undefined) ?? pool.warmupPolicy,
    targetPerSmtpRps: Number(rawSummary.targetPerSmtpRps ?? pool.targetPerSmtpRps ?? 0)
  } as {
    warmupPolicy?: "automatic_recommended" | "force_target" | "conservative";
    targetPerSmtpRps?: number;
  };
  cachedDailyTargetSummary = {
    value,
    expiresAt: now + WORKER_SETTINGS_CACHE_MS
  };
  return value;
}

export async function getEffectiveRateForSmtp(smtpAccountId: string) {
  const smtp = await prisma.smtpAccount.findUnique({ where: { id: smtpAccountId } });
  if (!smtp) {
    throw new Error("smtp_not_found");
  }

  const targetSummary = await getDailyTargetSummaryCached();
  const forceTargetActive = isForceTargetPolicy(targetSummary);
  const targetPerSmtpRps = Math.max(0, Number(targetSummary.targetPerSmtpRps ?? 0));
  const providerSafeCap = smtpLooksAlibaba(smtp) ? ALIBABA_PROVIDER_SAFE_MAX_RPS : SMTP_DEFAULT_PROVIDER_SAFE_MAX_RPS;

  if (
    forceTargetActive &&
    targetPerSmtpRps > 0 &&
    !smtp.isThrottled &&
    smtp.healthStatus !== "error" &&
    !isAuthFailedSignal(smtp)
  ) {
    const explicitMax = Number(smtp.maxRatePerSecond ?? 0);
    const manualHardCap = explicitMax > 0 && explicitMax + 0.0001 < targetPerSmtpRps;
    const allowedByMax = manualHardCap ? explicitMax : targetPerSmtpRps;
    const forcedRate = Math.max(0.01, Number(Math.min(targetPerSmtpRps, allowedByMax, providerSafeCap).toFixed(4)));
    return {
      effectiveRatePerSecond: forcedRate,
      reasons: manualHardCap ? ["force_target_override", "manual_lock"] : ["force_target_override"],
      warmupTierName: undefined,
      nextTierName: undefined
    };
  }

  const warmupAgg = await prisma.smtpWarmupStat.aggregate({
    where: { smtpAccountId },
    _sum: { successfulDeliveries: true }
  });
  const deliveredSuccessCount = warmupAgg._sum.successfulDeliveries ?? 0;

  const normalizedAlibabaWarmupCap = Math.max(
    Number(smtp.alibabaWarmupMaxRatePerSecond ?? 0),
    Number(smtp.warmupMaxRps ?? 0),
    Number(smtp.targetRatePerSecond ?? 0)
  );

  const decision = calculateEffectiveRate({
    smtpHost: smtp.host,
    targetRatePerSecond: smtp.targetRatePerSecond,
    alibabaRateCap: smtp.alibabaRateCap,
    maxRatePerSecond: smtp.maxRatePerSecond,
    alibabaWarmupMaxRatePerSecond: normalizedAlibabaWarmupCap > 0 ? normalizedAlibabaWarmupCap : undefined,
    deliveredSuccessCount,
    warmupLadder: DEFAULT_ALIBABA_LADDER,
    bypassAlibabaWarmupConstraints: false
  });

  if (smtp.isThrottled) {
    return {
      ...decision,
      effectiveRatePerSecond: Math.max(0.01, Number((decision.effectiveRatePerSecond * 0.5).toFixed(4))),
      reasons: [...decision.reasons, "safety_mode_throttle"]
    };
  }

  if (smtp.warmupEnabled) {
    const customWarmupRate = Math.min(
      Math.max(Number(smtp.warmupMaxRps ?? 0), Number(smtp.targetRatePerSecond ?? 0), normalizedAlibabaWarmupCap || 0),
      smtp.warmupStartRps + Math.floor(deliveredSuccessCount / 1000) * smtp.warmupIncrementStep
    );
    return {
      ...decision,
      effectiveRatePerSecond: Math.max(0.01, Number(Math.min(decision.effectiveRatePerSecond, customWarmupRate).toFixed(4))),
      reasons: [...decision.reasons, "custom_warmup"]
    };
  }

  return decision;
}

export async function getEffectiveSendRate(input: {
  smtpAccountId: string;
  campaignId?: string;
  activePoolSmtpCount?: number;
}) {
  const smtpDecision = await getEffectiveRateForSmtp(input.smtpAccountId);
  const parallelSmtpCount = Math.max(1, Math.floor(Number(input.activePoolSmtpCount ?? 1)));
  return {
    ...smtpDecision,
    globalRatePerSecond: null,
    parallelSmtpCount,
    perSmtpRate: smtpDecision.effectiveRatePerSecond,
    smtpPoolMaxRate: smtpDecision.effectiveRatePerSecond,
    effectiveRatePerSecond: smtpDecision.effectiveRatePerSecond,
    reasons: smtpDecision.reasons
  };
}
