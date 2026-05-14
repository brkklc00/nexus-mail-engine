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
  groupLabel: z.string().optional().nullable(),
  connectionTimeout: z.number().int().positive().optional().nullable(),
  socketTimeout: z.number().int().positive().optional().nullable()
});

function isAlibabaProvider(providerLabel?: string | null, host?: string | null): boolean {
  const provider = (providerLabel ?? "").toLowerCase();
  const smtpHost = (host ?? "").toLowerCase();
  return provider.includes("alibaba") || provider.includes("aliyun") || smtpHost.includes("smtpdm");
}

function normalizeSmtpInput(input: z.infer<typeof schema>) {
  const alibaba = isAlibabaProvider(input.providerLabel, input.host);
  const normalizedEncryption =
    input.encryption === "ssl"
      ? "ssl"
      : input.encryption === "tls" || input.encryption === "starttls"
        ? "tls"
        : "none";
  const normalizedPort =
    normalizedEncryption === "ssl"
      ? 465
      : normalizedEncryption === "tls"
        ? 587
        : input.port;
  return {
    ...input,
    encryption: alibaba ? "ssl" : normalizedEncryption,
    port: alibaba ? 465 : normalizedPort
  };
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function isStatsQueryError(message: string): boolean {
  const value = message.toLowerCase();
  return (
    value.includes("campaignrecipient.count") ||
    value.includes("campaignrecipient") ||
    value.includes("could not resize shared memory segment") ||
    value.includes("no space left on device") ||
    value.includes("53100")
  );
}

function isUnknownSmtpFieldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid `prisma.smtpAccount") && message.includes("Unknown argument");
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const today = startOfToday();
  try {
    let smtpStatsUnavailable = false;
    const accountsPromise = prisma.smtpAccount
      .findMany({
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
          connectionTimeout: true,
          socketTimeout: true,
          updatedAt: true
        }
      })
      .catch(async (error: unknown) => {
        if (!isUnknownSmtpFieldError(error)) throw error;
        console.warn("[api/smtp GET] falling back to legacy smtp fields");
        const legacyRows = await prisma.smtpAccount.findMany({
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
            connectionTimeout: true,
            socketTimeout: true,
            updatedAt: true
          }
        });
        return legacyRows.map((row: any) => ({
          ...row,
          minuteCap: null,
          warmupEnabled: true,
          warmupStartRps: 1,
          warmupIncrementStep: 1,
          warmupMaxRps: null,
          healthStatus: "healthy",
          lastError: null,
          lastTestAt: null,
          lastSuccessAt: null,
          cooldownUntil: null,
          tags: [],
          groupLabel: null
        }));
      });

    const [accounts, smtpDailyLogAgg, warmupRows, poolSetting] = await Promise.all([
      accountsPromise,
      prisma.$queryRaw<Array<{ smtp_id: string; sent_total: bigint; failed_total: bigint }>>`
        SELECT
          (cl.metadata->>'smtpAccountId') AS smtp_id,
          COUNT(*) FILTER (WHERE cl."eventType" = 'sent')::bigint AS sent_total,
          COUNT(*) FILTER (WHERE cl."status" = 'failed')::bigint AS failed_total
        FROM "CampaignLog" cl
        WHERE cl."createdAt" >= ${today}
          AND (cl.metadata->>'smtpAccountId') IS NOT NULL
          AND (cl."eventType" = 'sent' OR cl."status" = 'failed')
        GROUP BY (cl.metadata->>'smtpAccountId')
      `.catch((error: unknown) => {
        smtpStatsUnavailable = true;
        console.warn("[api/smtp GET] grouped smtp stats unavailable", {
          message: error instanceof Error ? error.message : String(error)
        });
        return [];
      }),
      prisma.smtpWarmupStat.findMany({
        where: { date: { gte: today } },
        select: { smtpAccountId: true, successfulDeliveries: true, failedDeliveries: true, tierName: true, effectiveRate: true }
      }).catch((error: unknown) => {
        smtpStatsUnavailable = true;
        console.warn("[api/smtp GET] warmup smtp stats unavailable", {
          message: error instanceof Error ? error.message : String(error)
        });
        return [];
      }),
      prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } })
    ]);

    const smtpLogAggMap = new Map<string, { sent: number; failed: number }>(
      smtpDailyLogAgg.map((row: { smtp_id: string; sent_total: bigint; failed_total: bigint }) => [
        String(row.smtp_id),
        { sent: Number(row.sent_total ?? 0), failed: Number(row.failed_total ?? 0) }
      ])
    );
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
      const aggRow = smtpLogAggMap.get(account.id);
      const rawLastError = typeof account.lastError === "string" ? account.lastError : null;
      const statsQueryLikeError = rawLastError ? isStatsQueryError(rawLastError) : false;
      return {
        ...account,
        sentToday: Number(aggRow?.sent ?? row?.successfulDeliveries ?? 0),
        failedToday: Number(aggRow?.failed ?? row?.failedDeliveries ?? 0),
        warmupTier: row?.tierName ?? null,
        effectiveRps: row?.effectiveRate ?? account.targetRatePerSecond,
        statsUnavailable: smtpStatsUnavailable || statsQueryLikeError,
        lastError: statsQueryLikeError ? null : rawLastError
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

    const existingSettings = ((poolSetting?.value as any) ?? {}) as {
      rotateEvery?: number;
      rotateEveryN?: number;
      parallelSmtpCount?: number;
      parallelSmtpLanes?: number;
      globalRatePerSecond?: number;
    };
    const rotateEvery = Math.max(10, Number(existingSettings.rotateEveryN ?? existingSettings.rotateEvery ?? poolSettingsDefaults.rotateEvery));
    const parallelSmtpCount = Math.max(
      1,
      Number(existingSettings.parallelSmtpCount ?? existingSettings.parallelSmtpLanes ?? poolSettingsDefaults.parallelSmtpCount)
    );
    const globalRatePerSecond =
      typeof existingSettings.globalRatePerSecond === "number" && Number.isFinite(existingSettings.globalRatePerSecond)
        ? Math.max(0.01, Number(existingSettings.globalRatePerSecond))
        : poolSettingsDefaults.globalRatePerSecond;

    return NextResponse.json({
      ok: true,
      accounts: enriched,
      metrics: {
        totalSmtpAccounts: totalAccounts,
        activeSmtpAccounts: activeAccounts,
        healthySmtpAccounts: healthyAccounts,
        throttledSmtpAccounts: throttledAccounts,
        totalSentToday: enriched.reduce((sum: number, item: any) => sum + Number(item.sentToday ?? 0), 0),
        totalFailedToday: enriched.reduce((sum: number, item: any) => sum + Number(item.failedToday ?? 0), 0),
        effectiveTotalRps: Number(effectiveTotalRps.toFixed(2)),
        estimatedDailyCapacity
      },
      poolSettings: {
        ...poolSettingsDefaults,
        ...(poolSetting?.value as any),
        rotateEvery,
        rotateEveryN: rotateEvery,
        parallelSmtpCount,
        parallelSmtpLanes: parallelSmtpCount,
        globalRatePerSecond
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP accounts could not be loaded";
    console.error("[api/smtp GET] failed", error);
    return NextResponse.json({ ok: false, error: "SMTP accounts could not be loaded", reason: message, accounts: [] }, { status: 500 });
  }
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
  const normalized = normalizeSmtpInput(parsed.data);

  try {
    const fullData = {
      name: normalized.name,
      host: normalized.host,
      port: normalized.port,
      encryption: normalized.encryption,
      username: normalized.username,
      passwordEncrypted: encryptSmtpSecret(normalized.password),
      fromEmail: normalized.fromEmail,
      fromName: normalized.fromName ?? null,
      replyTo: normalized.replyTo ?? null,
      providerLabel: normalized.providerLabel ?? null,
      targetRatePerSecond: normalized.targetRatePerSecond ?? 1,
      maxRatePerSecond: normalized.maxRatePerSecond ?? null,
      dailyCap: normalized.dailyCap ?? null,
      hourlyCap: normalized.hourlyCap ?? null,
      minuteCap: normalized.minuteCap ?? null,
      warmupEnabled: normalized.warmupEnabled ?? true,
      warmupStartRps: normalized.warmupStartRps ?? 1,
      warmupIncrementStep: normalized.warmupIncrementStep ?? 1,
      warmupMaxRps: normalized.warmupMaxRps ?? null,
      tags: normalized.tags ?? [],
      groupLabel: normalized.groupLabel ?? null,
      connectionTimeout: normalized.connectionTimeout ?? null,
      socketTimeout: normalized.socketTimeout ?? null,
      healthStatus: "healthy"
    };

    let account: any;
    try {
      account = await prisma.smtpAccount.create({ data: fullData });
    } catch (error) {
      if (!isUnknownSmtpFieldError(error)) throw error;
      console.warn("[api/smtp POST] falling back to legacy smtp create fields");
      account = await prisma.smtpAccount.create({
        data: {
          name: normalized.name,
          host: normalized.host,
          port: normalized.port,
          encryption: normalized.encryption,
          username: normalized.username,
          passwordEncrypted: encryptSmtpSecret(normalized.password),
          fromEmail: normalized.fromEmail,
          fromName: normalized.fromName ?? null,
          replyTo: normalized.replyTo ?? null,
          providerLabel: normalized.providerLabel ?? null,
          targetRatePerSecond: normalized.targetRatePerSecond ?? 1,
          maxRatePerSecond: normalized.maxRatePerSecond ?? null,
          dailyCap: normalized.dailyCap ?? null,
          hourlyCap: normalized.hourlyCap ?? null,
          connectionTimeout: normalized.connectionTimeout ?? null,
          socketTimeout: normalized.socketTimeout ?? null
        }
      });
    }
    await writeAuditLog(session.userId, "smtp.create", "smtp_account", { smtpAccountId: account.id });
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP account could not be created";
    console.error("[api/smtp POST] failed", error);
    return NextResponse.json({ ok: false, error: "SMTP account could not be created", reason: message }, { status: 400 });
  }
}
