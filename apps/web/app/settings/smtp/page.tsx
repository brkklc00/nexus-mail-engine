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
  const [totalAccounts, activeAccounts, healthyAccounts, throttledAccounts, effectiveSum, sentAgg, failAgg, poolSettings, dailyTargetSummary] = await Promise.all([
    prisma.smtpAccount.count({ where: { isSoftDeleted: false } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isActive: true } }),
    prisma.smtpAccount.count({
      where: { isSoftDeleted: false, isActive: true, healthStatus: "healthy", isThrottled: false }
    }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isThrottled: true } }),
    prisma.smtpAccount.aggregate({
      where: { isSoftDeleted: false, isActive: true, isThrottled: false },
      _sum: { targetRatePerSecond: true }
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
    prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } }),
    prisma.appSetting.findUnique({ where: { key: "smtp_daily_target_summary" } })
  ]);
  const effectiveTotalRps = Number(effectiveSum._sum.targetRatePerSecond ?? 0);
  const estimatedDailyCapacity = Math.floor(effectiveTotalRps * 86400);

  return (
    <div className="space-y-4">
      <PageHeader
        title="SMTP Hesapları"
        description="SMTP havuzunu yönetin, günlük hedef belirleyin ve gönderim sağlığını izleyin."
      />
      <SmtpManager
        initialAccounts={[]}
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
        initialDailyTargetSummary={(dailyTargetSummary?.value as any) ?? null}
      />
    </div>
  );
}
