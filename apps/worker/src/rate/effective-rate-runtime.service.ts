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
