import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  dailyTarget: z.number().int().positive(),
  includeUnhealthy: z.boolean().optional(),
  includeThrottled: z.boolean().optional()
});

type PoolSettings = {
  skipUnhealthy?: boolean;
  skipThrottled?: boolean;
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const poolSetting = await prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } });
  const pool = ((poolSetting?.value as any) ?? {}) as PoolSettings;
  const includeUnhealthy = parsed.data.includeUnhealthy ?? !(pool.skipUnhealthy ?? true);
  const includeThrottled = parsed.data.includeThrottled ?? !(pool.skipThrottled ?? true);

  const smtpWhere: any = {
    isActive: true,
    isSoftDeleted: false,
    ...(includeThrottled ? {} : { isThrottled: false }),
    ...(includeUnhealthy ? {} : { NOT: { healthStatus: "error" } })
  };
  const usableSmtps = await prisma.smtpAccount.findMany({
    where: smtpWhere,
    select: { id: true }
  });
  if (usableSmtps.length === 0) {
    return NextResponse.json({ ok: false, error: "No usable SMTP accounts found" }, { status: 400 });
  }

  const dailyTarget = Number(parsed.data.dailyTarget);
  const globalRps = Number((dailyTarget / 86400).toFixed(6));
  const perSmtpRps = Number((globalRps / usableSmtps.length).toFixed(6));
  const perSmtpDailyCap = Math.max(1, Math.ceil(dailyTarget / usableSmtps.length));
  const perSmtpHourlyCap = Math.max(1, Math.ceil(perSmtpDailyCap / 24));
  const perSmtpMinuteCap = Math.max(1, Math.ceil(perSmtpHourlyCap / 60));

  const updated = await prisma.smtpAccount.updateMany({
    where: smtpWhere,
    data: {
      targetRatePerSecond: perSmtpRps,
      maxRatePerSecond: perSmtpRps,
      dailyCap: perSmtpDailyCap,
      hourlyCap: perSmtpHourlyCap,
      minuteCap: perSmtpMinuteCap
    }
  });

  await writeAuditLog(session.userId, "smtp.apply_rate_planner", "smtp_account", {
    smtpUpdated: updated.count,
    dailyTarget,
    globalRps,
    perSmtpRps,
    includeUnhealthy,
    includeThrottled
  });

  return NextResponse.json({
    ok: true,
    smtpUpdated: updated.count,
    dailyTarget,
    globalRps,
    perSmtpRps,
    perSmtpDailyCap,
    perSmtpHourlyCap,
    perSmtpMinuteCap
  });
}
