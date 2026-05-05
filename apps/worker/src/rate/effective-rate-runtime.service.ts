import { prisma } from "@nexus/db";
import { calculateEffectiveRate, type WarmupTier } from "@nexus/rate-control";

const DEFAULT_ALIBABA_LADDER: WarmupTier[] = [
  { name: "0-500", minDelivered: 0, ratePerSecond: 1 },
  { name: "501-2k", minDelivered: 501, ratePerSecond: 2 },
  { name: "2k-5k", minDelivered: 2001, ratePerSecond: 3 },
  { name: "5k-10k", minDelivered: 5001, ratePerSecond: 5 },
  { name: "10k-25k", minDelivered: 10001, ratePerSecond: 8 },
  { name: "25k-50k", minDelivered: 25001, ratePerSecond: 10 },
  { name: "50k+", minDelivered: 50001, ratePerSecond: 15 }
];

export async function getEffectiveRateForSmtp(smtpAccountId: string) {
  const smtp = await prisma.smtpAccount.findUnique({ where: { id: smtpAccountId } });
  if (!smtp) {
    throw new Error("smtp_not_found");
  }

  const warmupAgg = await prisma.smtpWarmupStat.aggregate({
    where: { smtpAccountId },
    _sum: { successfulDeliveries: true }
  });
  const deliveredSuccessCount = warmupAgg._sum.successfulDeliveries ?? 0;

  const decision = calculateEffectiveRate({
    smtpHost: smtp.host,
    targetRatePerSecond: smtp.targetRatePerSecond,
    alibabaRateCap: smtp.alibabaRateCap,
    maxRatePerSecond: smtp.maxRatePerSecond,
    alibabaWarmupMaxRatePerSecond: smtp.alibabaWarmupMaxRatePerSecond,
    deliveredSuccessCount,
    warmupLadder: DEFAULT_ALIBABA_LADDER
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
      smtp.warmupMaxRps ?? Number.MAX_SAFE_INTEGER,
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

type PoolRateSettings = {
  globalRatePerSecond: number | null;
  parallelSmtpCount: number;
};

function normalizePoolRateSettings(value: unknown): PoolRateSettings {
  const raw = (value ?? {}) as {
    globalRatePerSecond?: number;
    parallelSmtpCount?: number;
    parallelSmtpLanes?: number;
  };
  const globalRate =
    typeof raw.globalRatePerSecond === "number" && Number.isFinite(raw.globalRatePerSecond) && raw.globalRatePerSecond > 0
      ? raw.globalRatePerSecond
      : null;
  const parallel = Math.max(1, Math.floor(Number(raw.parallelSmtpCount ?? raw.parallelSmtpLanes ?? 1)));
  return {
    globalRatePerSecond: globalRate,
    parallelSmtpCount: parallel
  };
}

export async function getEffectiveSendRate(input: {
  smtpAccountId: string;
  campaignId?: string;
  activePoolSmtpCount?: number;
}) {
  const [smtpDecision, poolSetting, campaign] = await Promise.all([
    getEffectiveRateForSmtp(input.smtpAccountId),
    prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } }),
    input.campaignId
      ? prisma.campaign.findUnique({
          where: { id: input.campaignId },
          select: { smtpPoolConfig: true }
        })
      : Promise.resolve(null)
  ]);

  const poolSettings = normalizePoolRateSettings(poolSetting?.value);
  const campaignPool = ((campaign?.smtpPoolConfig as any) ?? {}) as {
    parallelSmtpCount?: number;
  };
  const parallelSmtpCount = Math.max(
    1,
    Math.floor(
      Number(input.activePoolSmtpCount ?? campaignPool.parallelSmtpCount ?? poolSettings.parallelSmtpCount)
    )
  );

  const globalRatePerSecond = poolSettings.globalRatePerSecond;
  const perSmtpRate = globalRatePerSecond
    ? Number((globalRatePerSecond / parallelSmtpCount).toFixed(4))
    : smtpDecision.effectiveRatePerSecond;
  const effectiveRatePerSecond = Number(
    Math.max(0.01, Math.min(smtpDecision.effectiveRatePerSecond, perSmtpRate)).toFixed(4)
  );

  return {
    ...smtpDecision,
    globalRatePerSecond,
    parallelSmtpCount,
    perSmtpRate,
    smtpPoolMaxRate: smtpDecision.effectiveRatePerSecond,
    effectiveRatePerSecond,
    reasons: globalRatePerSecond
      ? [...smtpDecision.reasons, "global_rate_planner"]
      : smtpDecision.reasons
  };
}
