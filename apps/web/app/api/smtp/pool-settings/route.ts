import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  sendingMode: z.enum(["single", "pool"]).default("pool"),
  useAllActiveByDefault: z.boolean().default(true),
  rotateEvery: z.number().int().min(10).max(10000).default(500),
  rotateEveryN: z.number().int().min(10).max(10000).optional(),
  parallelSmtpLanes: z.number().int().min(1).max(50).optional(),
  parallelSmtpCount: z.number().int().min(1).max(50).optional(),
  globalRatePerSecond: z.number().positive().max(1000000).optional(),
  perSmtpConcurrency: z.number().int().min(1).max(50).default(1),
  skipThrottled: z.boolean().default(true),
  skipUnhealthy: z.boolean().default(true),
  fallbackToNextOnError: z.boolean().default(true),
  retryCount: z.number().int().min(0).max(20).default(5),
  retryDelayMs: z.number().int().min(0).max(120000).default(2000),
  cooldownAfterErrorSec: z.number().int().min(0).max(3600).default(60)
});

const defaults = {
  sendingMode: "pool",
  useAllActiveByDefault: true,
  rotateEvery: 500,
  rotateEveryN: 500,
  globalRatePerSecond: 1,
  parallelSmtpCount: 2,
  parallelSmtpLanes: 2,
  perSmtpConcurrency: 1,
  skipThrottled: true,
  skipUnhealthy: true,
  fallbackToNextOnError: true,
  retryCount: 5,
  retryDelayMs: 2000,
  cooldownAfterErrorSec: 60
};

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const row = await prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } });
  const existing = (row?.value as any) ?? {};
  const rotateEvery = Math.max(10, Number(existing.rotateEveryN ?? existing.rotateEvery ?? defaults.rotateEvery));
  const parallelSmtpCount = Math.max(
    1,
    Number(existing.parallelSmtpCount ?? existing.parallelSmtpLanes ?? defaults.parallelSmtpCount)
  );
  const globalRatePerSecond =
    typeof existing.globalRatePerSecond === "number" && Number.isFinite(existing.globalRatePerSecond)
      ? Math.max(0.01, Number(existing.globalRatePerSecond))
      : defaults.globalRatePerSecond;
  return NextResponse.json({
    ok: true,
    settings: {
      ...defaults,
      ...existing,
      rotateEvery,
      rotateEveryN: rotateEvery,
      parallelSmtpCount,
      parallelSmtpLanes: parallelSmtpCount,
      globalRatePerSecond
    }
  });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }
  const rotateEvery = Math.max(10, Number(parsed.data.rotateEveryN ?? parsed.data.rotateEvery ?? defaults.rotateEvery));
  const parallelSmtpCount = Math.max(
    1,
    Number(parsed.data.parallelSmtpCount ?? parsed.data.parallelSmtpLanes ?? defaults.parallelSmtpCount)
  );
  const normalizedValue = {
    ...parsed.data,
    rotateEvery,
    rotateEveryN: rotateEvery,
    parallelSmtpCount,
    parallelSmtpLanes: parallelSmtpCount,
    globalRatePerSecond: parsed.data.globalRatePerSecond ?? defaults.globalRatePerSecond
  };
  const row = await prisma.appSetting.upsert({
    where: { key: "smtp_pool_settings" },
    create: { key: "smtp_pool_settings", value: normalizedValue as any },
    update: { value: normalizedValue as any }
  });
  await writeAuditLog(session.userId, "smtp.pool_settings.update", "app_setting", { key: "smtp_pool_settings" });
  return NextResponse.json({ ok: true, settings: row.value });
}
