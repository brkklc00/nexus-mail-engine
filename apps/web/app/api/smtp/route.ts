import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { encryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const poolSettingsDefaults = {
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

const schema = z.object({
  name: z.string().min(2),
  host: z.string().min(2),
  port: z.number().int().positive(),
  encryption: z.enum(["none", "tls", "ssl", "starttls"]),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  replyTo: z.string().email().optional().nullable(),
  providerLabel: z.string().optional().nullable(),
  targetRatePerSecond: z.number().positive().optional(),
  maxRatePerSecond: z.number().positive().optional().nullable(),
  dailyCap: z.number().int().positive().optional().nullable(),
  hourlyCap: z.number().int().positive().optional().nullable(),
  minuteCap: z.number().int().positive().optional().nullable(),
  warmupEnabled: z.boolean().optional(),
  warmupStartRps: z.number().positive().optional(),
  warmupIncrementStep: z.number().positive().optional(),
  warmupMaxRps: z.number().positive().optional().nullable(),
  tags: z.array(z.string()).optional(),
  groupLabel: z.string().optional().nullable()
});

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const today = startOfToday();
  const [accounts, sentTodayAgg, failedTodayAgg, warmupRows, poolSetting] = await Promise.all([
    prisma.smtpAccount.findMany({
      where: { isSoftDeleted: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        encryption: true,
        username: true,
        fromEmail: true,
        fromName: true,
        replyTo: true,
        providerLabel: true,
        isActive: true,
        isThrottled: true,
        throttleReason: true,
        targetRatePerSecond: true,
        maxRatePerSecond: true,
        dailyCap: true,
        hourlyCap: true,
        minuteCap: true,
        warmupEnabled: true,
        warmupStartRps: true,
        warmupIncrementStep: true,
        warmupMaxRps: true,
        healthStatus: true,
        lastError: true,
        lastTestAt: true,
        lastSuccessAt: true,
        cooldownUntil: true,
        tags: true,
        groupLabel: true,
        updatedAt: true
      }
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
    prisma.smtpWarmupStat.findMany({
      where: { date: { gte: today } },
      select: { smtpAccountId: true, successfulDeliveries: true, failedDeliveries: true, tierName: true, effectiveRate: true }
    }),
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
    const row = warmupMap.get(account.id);
    return {
      ...account,
      sentToday: Number(row?.successfulDeliveries ?? 0),
      failedToday: Number(row?.failedDeliveries ?? 0),
      warmupTier: row?.tierName ?? null,
      effectiveRps: row?.effectiveRate ?? account.targetRatePerSecond
    };
  });
  const totalAccounts = enriched.length;
  const activeAccounts = enriched.filter((account: any) => account.isActive).length;
  const healthyAccounts = enriched.filter((account: any) => account.isActive && account.healthStatus === "healthy" && !account.isThrottled).length;
  const throttledAccounts = enriched.filter((account: any) => account.isThrottled).length;
  const effectiveTotalRps = enriched
    .filter((account: any) => account.isActive && !account.isThrottled)
    .reduce((sum: number, account: any) => sum + Number(account.effectiveRps ?? account.targetRatePerSecond ?? 0), 0);
  const estimatedDailyCapacity = Math.floor(effectiveTotalRps * 86400);

  return NextResponse.json({
    ok: true,
    accounts: enriched,
    metrics: {
      totalSmtpAccounts: totalAccounts,
      activeSmtpAccounts: activeAccounts,
      healthySmtpAccounts: healthyAccounts,
      throttledSmtpAccounts: throttledAccounts,
      totalSentToday: Number(sentTodayAgg[0]?.total ?? 0),
      totalFailedToday: Number(failedTodayAgg[0]?.total ?? 0),
      effectiveTotalRps: Number(effectiveTotalRps.toFixed(2)),
      estimatedDailyCapacity
    },
    poolSettings: (poolSetting?.value as any) ?? poolSettingsDefaults
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const account = await prisma.smtpAccount.create({
    data: {
      name: parsed.data.name,
      host: parsed.data.host,
      port: parsed.data.port,
      encryption: parsed.data.encryption,
      username: parsed.data.username,
      passwordEncrypted: encryptSmtpSecret(parsed.data.password),
      fromEmail: parsed.data.fromEmail,
      fromName: parsed.data.fromName ?? null,
      replyTo: parsed.data.replyTo ?? null,
      providerLabel: parsed.data.providerLabel ?? null,
      targetRatePerSecond: parsed.data.targetRatePerSecond ?? 1,
      maxRatePerSecond: parsed.data.maxRatePerSecond ?? null,
      dailyCap: parsed.data.dailyCap ?? null,
      hourlyCap: parsed.data.hourlyCap ?? null,
      minuteCap: parsed.data.minuteCap ?? null,
      warmupEnabled: parsed.data.warmupEnabled ?? true,
      warmupStartRps: parsed.data.warmupStartRps ?? 1,
      warmupIncrementStep: parsed.data.warmupIncrementStep ?? 1,
      warmupMaxRps: parsed.data.warmupMaxRps ?? null,
      tags: parsed.data.tags ?? [],
      groupLabel: parsed.data.groupLabel ?? null,
      healthStatus: "healthy"
    }
  });
  await writeAuditLog(session.userId, "smtp.create", "smtp_account", { smtpAccountId: account.id });
  return NextResponse.json({ ok: true, account });
}
