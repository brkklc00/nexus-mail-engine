import { prisma } from "@nexus/db";
import { PageHeader } from "@/components/ui/page-header";
import { SmtpManager } from "@/components/smtp/smtp-manager";

export const dynamic = "force-dynamic";

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export default async function SmtpSettingsPage() {
  const today = startOfToday();
  const [accounts, warmupRows, sentAgg, failAgg, poolSettings] = await Promise.all([
    prisma.smtpAccount.findMany({
      where: { isSoftDeleted: false },
      orderBy: { createdAt: "desc" }
    }),
    prisma.smtpWarmupStat.findMany({
      where: { date: { gte: today } },
      select: { smtpAccountId: true, successfulDeliveries: true, failedDeliveries: true, tierName: true, effectiveRate: true }
    }),
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint as total
      FROM "CampaignLog" cl
      JOIN "Campaign" c ON c.id = cl."campaignId"
      WHERE cl."eventType" = 'sent' AND cl."createdAt" >= ${today}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint as total
      FROM "CampaignLog" cl
      JOIN "Campaign" c ON c.id = cl."campaignId"
      WHERE cl."status" = 'failed' AND cl."createdAt" >= ${today}
    `,
    prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } })
  ]);
  const warmupMap = new Map<string, { smtpAccountId: string; successfulDeliveries: number; failedDeliveries: number; tierName: string | null; effectiveRate: number | null }>(
    warmupRows.map((row: any) => [
      row.smtpAccountId as string,
      {
        smtpAccountId: row.smtpAccountId as string,
        successfulDeliveries: Number(row.successfulDeliveries ?? 0),
        failedDeliveries: Number(row.failedDeliveries ?? 0),
        tierName: row.tierName ?? null,
        effectiveRate: row.effectiveRate ?? null
      }
    ])
  );
  const enriched = accounts.map((account: any) => {
    const warm = warmupMap.get(account.id);
    return {
      ...account,
      sentToday: Number(warm?.successfulDeliveries ?? 0),
      failedToday: Number(warm?.failedDeliveries ?? 0),
      warmupTier: warm?.tierName ?? null,
      effectiveRps: Number(warm?.effectiveRate ?? account.targetRatePerSecond ?? 0)
    };
  });
  const totalAccounts = enriched.length;
  const activeAccounts = enriched.filter((item: any) => item.isActive).length;
  const healthyAccounts = enriched.filter((item: any) => item.isActive && item.healthStatus === "healthy" && !item.isThrottled).length;
  const throttledAccounts = enriched.filter((item: any) => item.isThrottled).length;
  const effectiveTotalRps = enriched
    .filter((item: any) => item.isActive && !item.isThrottled)
    .reduce((sum: number, item: any) => sum + Number(item.effectiveRps ?? 0), 0);
  const estimatedDailyCapacity = Math.floor(effectiveTotalRps * 86400);

  return (
    <div className="space-y-4">
      <PageHeader
        title="SMTP Accounts"
        description="SMTP Pool + Rate Control + Warmup + Rotation Engine merkezi."
      />
      <SmtpManager
        initialAccounts={enriched as any}
        initialMetrics={{
          totalSmtpAccounts: totalAccounts,
          activeSmtpAccounts: activeAccounts,
          healthySmtpAccounts: healthyAccounts,
          throttledSmtpAccounts: throttledAccounts,
          totalSentToday: Number(sentAgg[0]?.total ?? 0),
          totalFailedToday: Number(failAgg[0]?.total ?? 0),
          effectiveTotalRps: Number(effectiveTotalRps.toFixed(2)),
          estimatedDailyCapacity
        }}
        initialPoolSettings={(poolSettings?.value as any) ?? null}
      />
    </div>
  );
}
