import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  sendingMode: z.enum(["single", "pool"]).default("pool"),
  useAllActiveByDefault: z.boolean().default(true),
  rotateEvery: z.number().int().min(10).max(10000).default(500),
  parallelSmtpLanes: z.number().int().min(1).max(50).default(2),
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
  return NextResponse.json({ ok: true, settings: (row?.value as any) ?? defaults });
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
  const row = await prisma.appSetting.upsert({
    where: { key: "smtp_pool_settings" },
    create: { key: "smtp_pool_settings", value: parsed.data as any },
    update: { value: parsed.data as any }
  });
  await writeAuditLog(session.userId, "smtp.pool_settings.update", "app_setting", { key: "smtp_pool_settings" });
  return NextResponse.json({ ok: true, settings: row.value });
}
