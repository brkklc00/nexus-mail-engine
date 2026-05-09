import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  dailyTarget: z.number().int().positive(),
  scope: z.enum(["healthy_active", "all_active", "selected"]).default("healthy_active"),
  smtpAccountIds: z.array(z.string().uuid()).optional(),
  warmupPolicy: z.enum(["automatic_recommended", "force_target", "conservative"]).default("automatic_recommended"),
  warmupAutoAdjust: z.boolean().optional().default(true),
  forceTargetForWarmed: z.boolean().optional().default(false),
  clearExpiredThrottle: z.boolean().optional().default(true),
  useAllEligibleParallel: z.boolean().optional().default(true),
  updateWorkerPoolSettings: z.boolean().optional().default(true),
  applyToRunningCampaigns: z.boolean().optional().default(true),
  updateWarmupToTarget: z.boolean().optional().default(true),
  excludeUnhealthy: z.boolean().optional().default(true),
  enforceSuppressionChecks: z.boolean().optional().default(true)
});

type SmtpRow = {
  id: string;
  host: string;
  providerLabel: string | null;
  isActive: boolean;
  isSoftDeleted: boolean;
  isThrottled: boolean;
  throttleReason: string | null;
  cooldownUntil: Date | null;
  lastError: string | null;
  healthStatus: string;
  username: string;
  fromEmail: string;
  passwordEncrypted: string;
  port: number;
  warmupEnabled: boolean;
  warmupMaxRps: number | null;
};

function isAlibabaProvider(smtp: Pick<SmtpRow, "host" | "providerLabel">): boolean {
  const provider = String(smtp.providerLabel ?? "").toLowerCase();
  const host = String(smtp.host ?? "").toLowerCase();
  return provider.includes("alibaba") || provider.includes("aliyun") || host.includes("smtpdm");
}

function roundRate(input: number) {
  return Number(Math.max(0.01, input).toFixed(4));
}

function isAuthFailed(smtp: Pick<SmtpRow, "healthStatus" | "throttleReason" | "lastError">): boolean {
  const raw = `${smtp.healthStatus ?? ""} ${smtp.throttleReason ?? ""} ${smtp.lastError ?? ""}`.toLowerCase();
  return raw.includes("auth_failed") || raw.includes("authentication") || raw.includes("invalid credentials");
}

function warmupLadderRps(successfulDeliveries: number, targetPerSmtpRps: number) {
  if (successfulDeliveries <= 500) return Math.min(targetPerSmtpRps, 1);
  if (successfulDeliveries <= 2000) return Math.min(targetPerSmtpRps, 2);
  if (successfulDeliveries <= 5000) return Math.min(targetPerSmtpRps, 3);
  if (successfulDeliveries <= 10000) return Math.min(targetPerSmtpRps, 5);
  if (successfulDeliveries <= 25000) return Math.min(targetPerSmtpRps, 8);
  if (successfulDeliveries <= 50000) return Math.min(targetPerSmtpRps, 10);
  return Math.min(targetPerSmtpRps, 15);
}

function isCredentialsMissing(smtp: Pick<SmtpRow, "host" | "port" | "username" | "fromEmail" | "passwordEncrypted">) {
  return !smtp.host || !smtp.port || !smtp.username || !smtp.fromEmail || !smtp.passwordEncrypted;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const selectedIds = new Set((parsed.data.smtpAccountIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const allActiveRows = (await prisma.smtpAccount.findMany({
    where: {
      isSoftDeleted: false,
      isActive: true
    },
    select: {
      id: true,
      host: true,
      providerLabel: true,
      isActive: true,
      isSoftDeleted: true,
      isThrottled: true,
      throttleReason: true,
      cooldownUntil: true,
      lastError: true,
      healthStatus: true,
      username: true,
      fromEmail: true,
      passwordEncrypted: true,
      port: true,
      warmupEnabled: true,
      warmupMaxRps: true
    }
  })) as SmtpRow[];

  const now = Date.now();
  const scopeFiltered = allActiveRows.filter((row) => {
    if (row.isSoftDeleted || !row.isActive) return false;
    if (parsed.data.scope === "healthy_active") {
      return row.healthStatus === "healthy";
    }
    if (parsed.data.scope === "selected") {
      return selectedIds.has(row.id);
    }
    return true;
  });

  const exclusion = {
    unhealthy: 0,
    throttled: 0,
    authFailed: 0,
    missingCredentials: 0,
    archived: 0
  };
  const excludedDetails: Array<{ id: string; reason: string }> = [];
  let usable = scopeFiltered.filter((smtp) => {
    if (smtp.isSoftDeleted) {
      exclusion.archived += 1;
      excludedDetails.push({ id: smtp.id, reason: "archived" });
      return false;
    }
    if (isCredentialsMissing(smtp)) {
      exclusion.missingCredentials += 1;
      excludedDetails.push({ id: smtp.id, reason: "missing_credentials" });
      return false;
    }
    if (isAuthFailed(smtp)) {
      exclusion.authFailed += 1;
      excludedDetails.push({ id: smtp.id, reason: "auth_failed" });
      return false;
    }
    if (parsed.data.excludeUnhealthy && smtp.healthStatus !== "healthy") {
      exclusion.unhealthy += 1;
      excludedDetails.push({ id: smtp.id, reason: "unhealthy" });
      return false;
    }
    const throttleExpired = smtp.cooldownUntil ? smtp.cooldownUntil.getTime() <= now : true;
    if (smtp.isThrottled && !throttleExpired) {
      exclusion.throttled += 1;
      excludedDetails.push({ id: smtp.id, reason: "throttled" });
      return false;
    }
    return true;
  });
  const warnings: string[] = [];
  if (usable.length === 0) {
    return NextResponse.json({ ok: false, error: "Gonderim icin uygun aktif SMTP bulunamadi." }, { status: 400 });
  }

  const warmupAgg = await prisma.smtpWarmupStat.groupBy({
    by: ["smtpAccountId"],
    where: {
      smtpAccountId: { in: usable.map((row) => row.id) }
    },
    _sum: { successfulDeliveries: true }
  });
  const deliveriesMap = new Map<string, number>(
    warmupAgg.map((row: any) => [row.smtpAccountId as string, Number(row._sum?.successfulDeliveries ?? 0)])
  );

  const usableSmtpCount = Math.max(1, usable.length);
  const targetTotalRps = Number((parsed.data.dailyTarget / 86400).toFixed(6));
  const targetPerSmtpRps = Number((targetTotalRps / usableSmtpCount).toFixed(6));
  const perSmtpDailyCap = Math.max(1, Math.ceil(parsed.data.dailyTarget / usableSmtpCount));
  const perSmtpHourlyCap = Math.max(1, Math.ceil(perSmtpDailyCap / 24));
  const perSmtpMinuteCap = Math.max(1, Math.ceil(perSmtpHourlyCap / 60));
  const alibabaSafeCap = Math.max(1, Number(process.env.ALIBABA_PROVIDER_SAFE_MAX_RPS ?? 15));
  const defaultProviderSafeCap = Math.max(1, Number(process.env.SMTP_DEFAULT_PROVIDER_SAFE_MAX_RPS ?? 5));

  let providerCapped = false;
  let warmupProtected = false;
  let warmupBottleneckSmtpCount = 0;
  let warmupPoolCapacityRps = 0;
  let providerCapPoolRps = 0;
  let throttleCapPoolRps = 0;
  let clearedExpiredThrottle = 0;
  let updated = 0;

  for (const smtp of usable) {
    const providerSafeCap = isAlibabaProvider(smtp) ? alibabaSafeCap : defaultProviderSafeCap;
    let desiredRps = Math.min(providerSafeCap, targetPerSmtpRps);
    providerCapPoolRps += desiredRps;
    if (desiredRps < targetPerSmtpRps) {
      providerCapped = true;
    }

    const successfulDeliveries = Number(deliveriesMap.get(smtp.id) ?? 0);
    const warmedEnough = successfulDeliveries >= 5000;
    let recommendedWarmupCap = warmupLadderRps(successfulDeliveries, desiredRps);
    if (parsed.data.warmupPolicy === "force_target" || (parsed.data.forceTargetForWarmed && warmedEnough)) {
      recommendedWarmupCap = Math.min(providerSafeCap, desiredRps);
    } else if (parsed.data.warmupPolicy === "conservative") {
      recommendedWarmupCap = Math.max(0.5, Math.min(recommendedWarmupCap, 2));
    }
    if (recommendedWarmupCap < desiredRps) {
      warmupProtected = true;
      warmupBottleneckSmtpCount += 1;
    }
    warmupPoolCapacityRps += Math.min(desiredRps, recommendedWarmupCap);
    if (smtp.isThrottled && smtp.cooldownUntil && smtp.cooldownUntil.getTime() > now) {
      throttleCapPoolRps += Math.max(0.01, Math.min(desiredRps, recommendedWarmupCap) * 0.5);
    } else {
      throttleCapPoolRps += Math.max(0.01, Math.min(desiredRps, recommendedWarmupCap));
    }

    const safeEffective = roundRate(desiredRps);
    const warmupStartRps = roundRate(Math.max(0.1, Math.min(safeEffective, Math.max(0.5, safeEffective * 0.35))));
    const warmupIncrementStep = roundRate(Math.max(0.1, Math.min(2, safeEffective * 0.5)));
    const targetWarmupCap = roundRate(
      Math.min(
        providerSafeCap,
        Math.max(
          Number(smtp.warmupMaxRps ?? 0),
          Number(recommendedWarmupCap),
          Number(parsed.data.warmupPolicy === "force_target" ? safeEffective : recommendedWarmupCap),
          Number(parsed.data.updateWarmupToTarget ? safeEffective : 0)
        )
      )
    );

    const updateData: any = {
      targetRatePerSecond: safeEffective,
      maxRatePerSecond: safeEffective,
      alibabaRateCap: isAlibabaProvider(smtp) ? Math.min(alibabaSafeCap, safeEffective) : null,
      warmupEnabled: parsed.data.warmupAutoAdjust ? true : undefined,
      warmupStartRps: roundRate(warmupStartRps),
      warmupIncrementStep: roundRate(warmupIncrementStep),
      warmupMaxRps: targetWarmupCap,
      alibabaWarmupMaxRatePerSecond: isAlibabaProvider(smtp) ? targetWarmupCap : null,
      dailyCap: perSmtpDailyCap,
      hourlyCap: perSmtpHourlyCap,
      minuteCap: perSmtpMinuteCap
    };
    const throttleExpired = smtp.cooldownUntil ? smtp.cooldownUntil.getTime() <= now : true;
    if (parsed.data.clearExpiredThrottle && smtp.isThrottled && throttleExpired && !isAuthFailed(smtp)) {
      updateData.isThrottled = false;
      updateData.throttleReason = null;
      updateData.cooldownUntil = null;
      clearedExpiredThrottle += 1;
    }

    const result = await prisma.smtpAccount.updateMany({
      where: {
        id: smtp.id,
        isActive: true,
        isSoftDeleted: false
      },
      data: updateData
    });
    updated += result.count;
  }

  if (providerCapped) {
    warnings.push("SMTP başı hız provider güvenlik limiti ile sınırlandı.");
  }
  if (warmupProtected) {
    warnings.push("Bazı SMTP'lerde warmup sınırı hedef hızı geçici olarak kısıtlıyor.");
    warnings.push("Warmup sınırı nedeniyle hedef hız düşüyor. Hedefi uygula butonuyla uygun SMTP’lerin warmup limitleri yükseltilebilir.");
  }
  if (usableSmtpCount < 3) {
    warnings.push("Uygun SMTP sayısı düşük, hedef hıza erişim sınırlı olabilir.");
  }
  if (!parsed.data.enforceSuppressionChecks) {
    warnings.push("Suppression/unsubscribe kontrolleri sistemde zorunlu olarak aktif kalır.");
  }
  if (clearedExpiredThrottle > 0) {
    warnings.push(`${clearedExpiredThrottle} adet süresi geçmiş throttle temizlendi.`);
  }

  const effectiveGlobalRps = Number((targetPerSmtpRps * updated).toFixed(6));
  const excludedSmtpCount = excludedDetails.length;

  if (parsed.data.updateWorkerPoolSettings) {
    const pool = await prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } });
    const current = ((pool?.value as any) ?? {}) as Record<string, unknown>;
    const nextParallel = parsed.data.useAllEligibleParallel ? usable.length : Number(current.parallelSmtpCount ?? usable.length);
    await prisma.appSetting.upsert({
      where: { key: "smtp_pool_settings" },
      create: {
        key: "smtp_pool_settings",
        value: {
          ...current,
          sendingMode: "pool",
          useAllActiveByDefault: true,
          globalRatePerSecond: targetTotalRps,
          parallelSmtpCount: Math.max(1, nextParallel),
          parallelSmtpLanes: Math.max(1, nextParallel),
          skipThrottled: true,
          skipUnhealthy: true
        } as any
      },
      update: {
        value: {
          ...current,
          sendingMode: "pool",
          useAllActiveByDefault: true,
          globalRatePerSecond: targetTotalRps,
          parallelSmtpCount: Math.max(1, nextParallel),
          parallelSmtpLanes: Math.max(1, nextParallel),
          skipThrottled: true,
          skipUnhealthy: true
        } as any
      }
    });
  }

  if (parsed.data.applyToRunningCampaigns) {
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: { in: ["running", "queued", "paused", "partially_completed"] },
        isDeleted: false
      },
      select: { id: true, smtpPoolConfig: true }
    });
    for (const campaign of campaigns) {
      const prev = campaign.smtpPoolConfig && typeof campaign.smtpPoolConfig === "object" ? (campaign.smtpPoolConfig as any) : {};
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          smtpPoolConfig: {
            ...prev,
            smtpMode: "pool",
            poolPolicy: "all_eligible",
            smtpIds: usable.map((smtp) => smtp.id),
            eligibleSmtpCount: usable.length,
            targetTotalRps,
            targetPerSmtpRps,
            parallelSmtpCount: Math.max(1, usable.length)
          }
        }
      });
    }
  }
  const summary = {
    dailyTarget: parsed.data.dailyTarget,
    scope: parsed.data.scope,
    warmupPolicy: parsed.data.warmupPolicy,
    usableSmtpCount,
    globalRps: targetTotalRps,
    effectiveGlobalRps,
    perSmtpRps: Number((updated > 0 ? effectiveGlobalRps / updated : 0).toFixed(6)),
    targetTotalRps,
    targetPerSmtpRps,
    warmupPoolCapacityRps: Number(warmupPoolCapacityRps.toFixed(6)),
    providerCapPoolRps: Number(providerCapPoolRps.toFixed(6)),
    throttleCapPoolRps: Number(throttleCapPoolRps.toFixed(6)),
    warmupBottleneckSmtpCount,
    warmupPoolCapacityDaily: Math.floor(warmupPoolCapacityRps * 86400),
    perSmtpDailyCap,
    perSmtpHourlyCap,
    perSmtpMinuteCap,
    updated,
    skipped: Math.max(0, usableSmtpCount - updated),
    excludedSmtpCount,
    excludedReasons: exclusion,
    warnings,
    updatedAt: new Date().toISOString()
  };

  await prisma.appSetting.upsert({
    where: { key: "smtp_daily_target_summary" },
    create: {
      key: "smtp_daily_target_summary",
      value: summary as any
    },
    update: {
      value: summary as any
    }
  });
  await prisma.appSetting.upsert({
    where: { key: "smtp_runtime_cache_bust" },
    create: {
      key: "smtp_runtime_cache_bust",
      value: {
        ts: Date.now(),
        source: "apply_daily_target"
      } as any
    },
    update: {
      value: {
        ts: Date.now(),
        source: "apply_daily_target"
      } as any
    }
  });

  await writeAuditLog(session.userId, "smtp.apply_daily_target", "smtp_account", {
    dailyTarget: summary.dailyTarget,
    scope: summary.scope,
    warmupPolicy: summary.warmupPolicy,
    usableSmtpCount: summary.usableSmtpCount,
    updated: summary.updated,
    warnings: summary.warnings
  });

  return NextResponse.json({
    ok: true,
    dailyTarget: summary.dailyTarget,
    usableSmtpCount: summary.usableSmtpCount,
    globalRps: summary.targetTotalRps,
    effectiveGlobalRps: summary.effectiveGlobalRps,
    perSmtpRps: summary.targetPerSmtpRps,
    targetTotalRps: summary.targetTotalRps,
    targetPerSmtpRps: summary.targetPerSmtpRps,
    warmupPoolCapacityRps: summary.warmupPoolCapacityRps,
    providerCapPoolRps: summary.providerCapPoolRps,
    throttleCapPoolRps: summary.throttleCapPoolRps,
    warmupBottleneckSmtpCount: summary.warmupBottleneckSmtpCount,
    warmupPoolCapacityDaily: summary.warmupPoolCapacityDaily,
    perSmtpDailyCap: summary.perSmtpDailyCap,
    perSmtpHourlyCap: summary.perSmtpHourlyCap,
    perSmtpMinuteCap: summary.perSmtpMinuteCap,
    excludedSmtpCount: summary.excludedSmtpCount,
    excludedReasons: summary.excludedReasons,
    updated: summary.updated,
    skipped: summary.skipped,
    warnings: summary.warnings
  });
}
