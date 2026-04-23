import { prisma } from "@nexus/db";
import { calculateEffectiveRate, type WarmupTier } from "@nexus/rate-control";

const DEFAULT_ALIBABA_LADDER: WarmupTier[] = [
  { name: "5k/day", minDelivered: 5000, ratePerSecond: 0.06 },
  { name: "10k/day", minDelivered: 10000, ratePerSecond: 0.12 },
  { name: "25k/day", minDelivered: 25000, ratePerSecond: 0.29 },
  { name: "50k/day", minDelivered: 50000, ratePerSecond: 0.58 },
  { name: "100k/day", minDelivered: 100000, ratePerSecond: 1.16 },
  { name: "250k/day", minDelivered: 250000, ratePerSecond: 2.89 },
  { name: "500k/day", minDelivered: 500000, ratePerSecond: 5.79 },
  { name: "750k/day", minDelivered: 750000, ratePerSecond: 8.68 },
  { name: "1m/day", minDelivered: 1000000, ratePerSecond: 11.57 },
  { name: "1.5m/day", minDelivered: 1500000, ratePerSecond: 17.36 },
  { name: "2m/day", minDelivered: 2000000, ratePerSecond: 23.15 },
  { name: "3m/day", minDelivered: 3000000, ratePerSecond: 34.72 },
  { name: "5m/day", minDelivered: 5000000, ratePerSecond: 57.87 },
  { name: "10m/day", minDelivered: 10000000, ratePerSecond: 115.74 },
  { name: "15m/day", minDelivered: 15000000, ratePerSecond: 173.61 },
  { name: "20m/day", minDelivered: 20000000, ratePerSecond: 231.48 },
  { name: "25m/day", minDelivered: 25000000, ratePerSecond: 289.35 },
  { name: "50m/day", minDelivered: 50000000, ratePerSecond: 578.7 }
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

  return decision;
}
