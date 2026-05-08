import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { resolveSmtpScope } from "@/app/api/smtp/_bulk-utils";

const scopeSchema = z.enum(["all_active", "selected", "healthy", "error"]);
const presetSchema = z.enum(["safe", "balanced", "fast", "aggressive", "custom", "daily_target"]);

const schema = z.object({
  scope: scopeSchema,
  smtpAccountIds: z.array(z.string()).optional(),
  preset: presetSchema,
  dailyTarget: z.number().int().positive().optional(),
  values: z
    .object({
      targetRatePerSecond: z.number().positive().optional(),
      maxRatePerSecond: z.number().positive().optional(),
      warmupEnabled: z.boolean().optional(),
      warmupStartRps: z.number().positive().optional(),
      warmupIncrementStep: z.number().positive().optional(),
      warmupMaxRps: z.number().positive().optional(),
      dailyCap: z.number().int().positive().optional(),
      hourlyCap: z.number().int().positive().optional(),
      minuteCap: z.number().int().positive().optional(),
      resetThrottle: z.boolean().optional(),
      clearCooldown: z.boolean().optional(),
      clearLastError: z.boolean().optional(),
      onlyActive: z.boolean().optional()
    })
    .optional()
});

const PRESETS: Record<"safe" | "balanced" | "fast" | "aggressive", Record<string, unknown>> = {
  safe: {
    targetRatePerSecond: 0.2,
    maxRatePerSecond: 0.5,
    warmupEnabled: true,
    warmupStartRps: 0.1,
    warmupIncrementStep: 0.1,
    warmupMaxRps: 1
  },
  balanced: {
    targetRatePerSecond: 0.5,
    maxRatePerSecond: 1,
    warmupEnabled: true,
    warmupStartRps: 0.2,
    warmupIncrementStep: 0.2,
    warmupMaxRps: 2
  },
  fast: {
    targetRatePerSecond: 1,
    maxRatePerSecond: 2,
    warmupEnabled: true,
    warmupStartRps: 0.5,
    warmupIncrementStep: 0.5,
    warmupMaxRps: 3
  },
  aggressive: {
    targetRatePerSecond: 2,
    maxRatePerSecond: 5,
    warmupEnabled: true,
    warmupStartRps: 1,
    warmupIncrementStep: 1,
    warmupMaxRps: 5
  }
};

function cleanAppliedValues(input: Record<string, unknown>) {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries);
}

function buildDailyTargetValues(dailyTarget: number, usableSmtpCount: number) {
  const globalRps = Number((dailyTarget / 86400).toFixed(6));
  const perSmtpRps = Number((globalRps / usableSmtpCount).toFixed(6));
  const perSmtpDailyCap = Math.max(1, Math.ceil(dailyTarget / usableSmtpCount));
  const perSmtpHourlyCap = Math.max(1, Math.ceil(perSmtpDailyCap / 24));
  const perSmtpMinuteCap = Math.max(1, Math.ceil(perSmtpHourlyCap / 60));
  return {
    preview: {
      totalSmtp: usableSmtpCount,
      usableSmtpCount,
      dailyTarget,
      globalRps,
      perSmtpRps,
      perSmtpDailyCap,
      perSmtpHourlyCap,
      perSmtpMinuteCap,
      estimatedTotalRps: Number((perSmtpRps * usableSmtpCount).toFixed(6))
    },
    values: {
      targetRatePerSecond: perSmtpRps,
      maxRatePerSecond: perSmtpRps,
      dailyCap: perSmtpDailyCap,
      hourlyCap: perSmtpHourlyCap,
      minuteCap: perSmtpMinuteCap
    }
  };
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

  const body = parsed.data;
  const onlyActive = body.values?.onlyActive ?? false;
  const resolved = await resolveSmtpScope({
    scope: body.scope,
    smtpAccountIds: body.smtpAccountIds,
    onlyActive
  });

  if (resolved.ids.length === 0) {
    return NextResponse.json({
      ok: true,
      updated: 0,
      skipped: 0,
      preview: null,
      appliedValues: {}
    });
  }

  let preview: Record<string, unknown> | null = null;
  let calculatedValues: Record<string, unknown> = {};

  if (body.preset === "daily_target") {
    const dailyTarget = Number(body.dailyTarget ?? 0);
    if (!Number.isFinite(dailyTarget) || dailyTarget <= 0) {
      return NextResponse.json({ ok: false, error: "dailyTarget is required for daily_target preset" }, { status: 400 });
    }
    const dailyTargetResult = buildDailyTargetValues(dailyTarget, resolved.ids.length);
    preview = dailyTargetResult.preview;
    calculatedValues = dailyTargetResult.values;
  } else if (body.preset === "custom") {
    calculatedValues = { ...(body.values ?? {}) };
  } else {
    calculatedValues = PRESETS[body.preset];
  }

  const updateData: Record<string, unknown> = {};
  const values = { ...(body.values ?? {}), ...calculatedValues };
  if (values.targetRatePerSecond !== undefined) updateData.targetRatePerSecond = values.targetRatePerSecond;
  if (values.maxRatePerSecond !== undefined) updateData.maxRatePerSecond = values.maxRatePerSecond;
  if (values.warmupEnabled !== undefined) updateData.warmupEnabled = values.warmupEnabled;
  if (values.warmupStartRps !== undefined) updateData.warmupStartRps = values.warmupStartRps;
  if (values.warmupIncrementStep !== undefined) updateData.warmupIncrementStep = values.warmupIncrementStep;
  if (values.warmupMaxRps !== undefined) updateData.warmupMaxRps = values.warmupMaxRps;
  if (values.dailyCap !== undefined) updateData.dailyCap = values.dailyCap;
  if (values.hourlyCap !== undefined) updateData.hourlyCap = values.hourlyCap;
  if (values.minuteCap !== undefined) updateData.minuteCap = values.minuteCap;
  if (values.resetThrottle) {
    updateData.isThrottled = false;
    updateData.throttleReason = null;
  }
  if (values.clearCooldown) updateData.cooldownUntil = null;
  if (values.clearLastError) updateData.lastError = null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ ok: false, error: "No values to update" }, { status: 400 });
  }

  const result = await prisma.smtpAccount.updateMany({
    where: {
      id: { in: resolved.ids },
      isSoftDeleted: false
    },
    data: updateData
  });

  await writeAuditLog(session.userId, "smtp.bulk_rate_warmup", "smtp_account", {
    scope: body.scope,
    selectedCount: body.smtpAccountIds?.length ?? 0,
    resolvedCount: resolved.ids.length,
    updated: result.count,
    preset: body.preset,
    preview,
    appliedValues: cleanAppliedValues(updateData)
  });

  return NextResponse.json({
    ok: true,
    updated: result.count,
    skipped: Math.max(0, resolved.ids.length - result.count),
    preview,
    appliedValues: cleanAppliedValues(updateData)
  });
}

