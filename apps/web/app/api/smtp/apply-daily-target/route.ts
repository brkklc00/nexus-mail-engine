import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  dailyTarget: z.number().int().positive(),
  mode: z.enum(["safe", "balanced", "fast", "aggressive"]).default("balanced"),
  scope: z.enum(["healthy_active", "all_active", "selected"]).default("healthy_active"),
  smtpAccountIds: z.array(z.string().uuid()).optional(),
  resetThrottle: z.boolean().optional().default(false),
  clearCooldown: z.boolean().optional().default(false),
  clearLastError: z.boolean().optional().default(false),
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
  healthStatus: string;
};

function isAlibabaProvider(smtp: Pick<SmtpRow, "host" | "providerLabel">): boolean {
  const provider = String(smtp.providerLabel ?? "").toLowerCase();
  const host = String(smtp.host ?? "").toLowerCase();
  return provider.includes("alibaba") || provider.includes("aliyun") || host.includes("smtpdm");
}

function roundRate(input: number) {
  return Number(Math.max(0.01, input).toFixed(4));
}

function modeMultiplier(mode: "safe" | "balanced" | "fast" | "aggressive") {
  if (mode === "safe") return 0.5;
  if (mode === "balanced") return 0.75;
  if (mode === "fast") return 1;
  return 1.2;
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
      healthStatus: true
    }
  })) as SmtpRow[];

  let usable = allActiveRows.filter((row) => !row.isSoftDeleted && row.isActive);
  if (parsed.data.scope === "healthy_active") {
    usable = usable.filter((row) => row.healthStatus === "healthy" && !row.isThrottled);
  } else if (parsed.data.scope === "selected") {
    usable = usable.filter((row) => selectedIds.has(row.id));
  }
  if (parsed.data.excludeUnhealthy) {
    usable = usable.filter((row) => row.healthStatus !== "error");
  }

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

  const usableSmtpCount = usable.length;
  const globalRps = Number((parsed.data.dailyTarget / 86400).toFixed(6));
  const basePerSmtpRps = Number((globalRps / usableSmtpCount).toFixed(6));
  const perSmtpDailyCap = Math.max(1, Math.ceil(parsed.data.dailyTarget / usableSmtpCount));
  const perSmtpHourlyCap = Math.max(1, Math.ceil(perSmtpDailyCap / 24));
  const perSmtpMinuteCap = Math.max(1, Math.ceil(perSmtpHourlyCap / 60));

  const multiplier = modeMultiplier(parsed.data.mode);
  const modePerSmtpRps = basePerSmtpRps * multiplier;

  let providerCapped = false;
  let warmupProtected = false;
  let updated = 0;

  for (const smtp of usable) {
    let effectiveRps = modePerSmtpRps;
    if (isAlibabaProvider(smtp) && effectiveRps > 5) {
      effectiveRps = 5;
      providerCapped = true;
    }

    const successfulDeliveries = deliveriesMap.get(smtp.id) ?? 0;
    if (successfulDeliveries < 500) {
      effectiveRps = Math.min(effectiveRps, 1);
      warmupProtected = true;
    }

    const safeEffective = roundRate(effectiveRps);
    let warmupStartRps = 0.2;
    if (parsed.data.mode === "safe") warmupStartRps = Math.max(0.1, safeEffective * 0.25);
    if (parsed.data.mode === "balanced") warmupStartRps = Math.max(0.2, safeEffective * 0.35);
    if (parsed.data.mode === "fast") warmupStartRps = Math.max(0.5, safeEffective * 0.5);
    if (parsed.data.mode === "aggressive") warmupStartRps = Math.max(1, safeEffective * 0.7);
    const warmupIncrementStep = Math.max(0.1, warmupStartRps * 0.5);

    const updateData: any = {
      targetRatePerSecond: safeEffective,
      maxRatePerSecond: safeEffective,
      alibabaRateCap: isAlibabaProvider(smtp) ? Math.min(5, safeEffective) : null,
      warmupEnabled: true,
      warmupStartRps: roundRate(warmupStartRps),
      warmupIncrementStep: roundRate(warmupIncrementStep),
      warmupMaxRps: safeEffective,
      dailyCap: perSmtpDailyCap,
      hourlyCap: perSmtpHourlyCap,
      minuteCap: perSmtpMinuteCap
    };
    if (parsed.data.resetThrottle) {
      updateData.isThrottled = false;
      updateData.throttleReason = null;
    }
    if (parsed.data.clearCooldown) {
      updateData.cooldownUntil = null;
    }
    if (parsed.data.clearLastError) {
      updateData.lastError = null;
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
    warnings.push("SMTP basi hiz Alibaba guvenlik limiti nedeniyle 5 RPS ile sinirlandi.");
  }
  if (warmupProtected) {
    warnings.push("Bazi SMTP'ler yeni/isinmamis oldugu icin otomatik guvenli hiz uygulanacak.");
  }
  if (usableSmtpCount < 3) {
    warnings.push("Saglikli SMTP sayisi dusuk, hedefe ulasmak zor olabilir.");
  }
  if (parsed.data.scope === "all_active" && parsed.data.excludeUnhealthy) {
    warnings.push("Sagliksiz SMTP'ler kapsam disi birakildi.");
  }
  if (parsed.data.mode === "aggressive" && parsed.data.dailyTarget >= 5_000_000) {
    warnings.push("Hedef cok yuksek; Agresif mod riskli olabilir.");
  }
  if (!parsed.data.enforceSuppressionChecks) {
    warnings.push("Suppression / unsubscribe kontrolleri sistem tarafinda zorunlu olarak calismaya devam eder.");
  }

  const effectiveGlobalRps = Number((updated > 0 ? modePerSmtpRps * updated : 0).toFixed(6));
  const summary = {
    dailyTarget: parsed.data.dailyTarget,
    mode: parsed.data.mode,
    scope: parsed.data.scope,
    usableSmtpCount,
    globalRps,
    effectiveGlobalRps,
    perSmtpRps: Number((updated > 0 ? effectiveGlobalRps / updated : 0).toFixed(6)),
    perSmtpDailyCap,
    perSmtpHourlyCap,
    perSmtpMinuteCap,
    updated,
    skipped: Math.max(0, usableSmtpCount - updated),
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

  await writeAuditLog(session.userId, "smtp.apply_daily_target", "smtp_account", {
    dailyTarget: summary.dailyTarget,
    mode: summary.mode,
    scope: summary.scope,
    usableSmtpCount: summary.usableSmtpCount,
    updated: summary.updated,
    warnings: summary.warnings
  });

  return NextResponse.json({
    ok: true,
    dailyTarget: summary.dailyTarget,
    mode: summary.mode,
    usableSmtpCount: summary.usableSmtpCount,
    globalRps: summary.globalRps,
    effectiveGlobalRps: summary.effectiveGlobalRps,
    perSmtpRps: summary.perSmtpRps,
    perSmtpDailyCap: summary.perSmtpDailyCap,
    perSmtpHourlyCap: summary.perSmtpHourlyCap,
    perSmtpMinuteCap: summary.perSmtpMinuteCap,
    updated: summary.updated,
    skipped: summary.skipped,
    warnings: summary.warnings
  });
}
