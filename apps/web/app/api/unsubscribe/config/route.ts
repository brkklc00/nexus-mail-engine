import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getUnsubscribeSettings } from "@/server/unsubscribe/settings";
import { verifyTrackingToken } from "@/server/tracking/token.service";

export async function GET(req: Request) {
  const settings = await getUnsubscribeSettings();
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  let prefilledEmail: string | null = null;
  let tokenValid = false;

  if (token) {
    try {
      const secret = process.env.TRACKING_SECRET ?? "change-me";
      const payload = verifyTrackingToken(token, secret);
      if (payload && payload.type === "unsubscribe") {
        const recipient = await prisma.recipient.findUnique({
          where: { id: payload.recipientId },
          select: { email: true }
        });
        if (recipient?.email) {
          prefilledEmail = recipient.email;
          tokenValid = true;
        }
      }
    } catch {
      tokenValid = false;
      prefilledEmail = null;
    }
  }

  return NextResponse.json({
    ok: true,
    enabled: settings.enabled,
    title: settings.title,
    description: settings.description,
    successMessage: settings.successMessage,
    errorMessage: settings.errorMessage,
    captchaEnabled: settings.captchaEnabled,
    captchaExpiryMinutes: settings.captchaExpiryMinutes,
    maxAttempts: settings.maxAttempts,
    allowManualEmailInput: settings.allowManualEmailInput,
    requireToken: settings.requireToken,
    footerText: settings.footerText,
    tokenValid,
    prefilledEmail
  });
}

