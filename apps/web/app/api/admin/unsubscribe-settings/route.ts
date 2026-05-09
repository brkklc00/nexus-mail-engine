import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import {
  UNSUBSCRIBE_SETTINGS_KEY,
  defaultUnsubscribeSettings,
  getUnsubscribeSettings,
  sanitizeUnsubscribeSettings
} from "@/server/unsubscribe/settings";

const schema = z.object({
  enabled: z.boolean(),
  title: z.string().min(1),
  description: z.string().min(1),
  successMessage: z.string().min(1),
  errorMessage: z.string().min(1),
  captchaEnabled: z.boolean(),
  captchaExpiryMinutes: z.number().int().min(1).max(60),
  maxAttempts: z.number().int().min(1).max(20),
  allowManualEmailInput: z.boolean(),
  requireToken: z.boolean(),
  removeFromAllLists: z.boolean(),
  addToSuppression: z.boolean(),
  suppressionReason: z.string().min(1),
  footerText: z.string().optional().default("")
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getUnsubscribeSettings();
  return NextResponse.json({ ok: true, settings });
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
  const safeSettings = sanitizeUnsubscribeSettings({
    ...defaultUnsubscribeSettings,
    ...parsed.data
  });
  await prisma.appSetting.upsert({
    where: { key: UNSUBSCRIBE_SETTINGS_KEY },
    create: { key: UNSUBSCRIBE_SETTINGS_KEY, value: safeSettings as any },
    update: { value: safeSettings as any }
  });
  await writeAuditLog(session.userId, "unsubscribe.settings.update", "app_setting", {
    key: UNSUBSCRIBE_SETTINGS_KEY
  });
  return NextResponse.json({ ok: true, settings: safeSettings });
}

