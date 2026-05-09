import { NextResponse } from "next/server";
import { createCaptcha } from "@/server/unsubscribe/captcha";
import { getUnsubscribeSettings } from "@/server/unsubscribe/settings";

export async function GET() {
  const settings = await getUnsubscribeSettings();
  if (!settings.enabled) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 403 });
  }
  if (!settings.captchaEnabled) {
    return NextResponse.json({
      ok: true,
      captchaId: "disabled",
      imageData: null,
      imageDataUrl: null,
      expiresInSeconds: 0
    });
  }
  const captcha = await createCaptcha({
    expiryMinutes: settings.captchaExpiryMinutes,
    maxAttempts: settings.maxAttempts
  });
  return NextResponse.json({
    ok: true,
    captchaId: captcha.captchaId,
    imageData: captcha.imageDataUrl,
    imageDataUrl: captcha.imageDataUrl,
    expiresInSeconds: captcha.expiresInSeconds
  });
}

