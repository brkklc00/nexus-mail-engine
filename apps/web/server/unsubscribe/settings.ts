import { prisma } from "@nexus/db";

export const UNSUBSCRIBE_SETTINGS_KEY = "unsubscribe_settings";

export type UnsubscribeSettings = {
  enabled: boolean;
  title: string;
  description: string;
  successMessage: string;
  errorMessage: string;
  captchaEnabled: boolean;
  captchaExpiryMinutes: number;
  maxAttempts: number;
  allowManualEmailInput: boolean;
  requireToken: boolean;
  removeFromAllLists: boolean;
  addToSuppression: boolean;
  suppressionReason: string;
  footerText: string;
};

export const defaultUnsubscribeSettings: UnsubscribeSettings = {
  enabled: true,
  title: "Abonelikten Çık",
  description: "E-posta adresinizi tüm gönderim listelerinden çıkarmak için doğrulama kodunu girin.",
  successMessage:
    "E-posta adresiniz tüm listelerden çıkarıldı ve tekrar gönderim yapılmaması için baskılama listesine eklendi.",
  errorMessage: "Doğrulama kodu hatalı veya süresi dolmuş.",
  captchaEnabled: true,
  captchaExpiryMinutes: 10,
  maxAttempts: 5,
  allowManualEmailInput: true,
  requireToken: false,
  removeFromAllLists: true,
  addToSuppression: true,
  suppressionReason: "unsubscribe",
  footerText: ""
};

function sanitizeText(input: unknown, fallback: string, maxLen = 280): string {
  const value = String(input ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return fallback;
  return value.slice(0, maxLen);
}

export function sanitizeUnsubscribeSettings(input: Partial<UnsubscribeSettings>): UnsubscribeSettings {
  return {
    enabled: Boolean(input.enabled ?? defaultUnsubscribeSettings.enabled),
    title: sanitizeText(input.title, defaultUnsubscribeSettings.title, 80),
    description: sanitizeText(input.description, defaultUnsubscribeSettings.description, 300),
    successMessage: sanitizeText(input.successMessage, defaultUnsubscribeSettings.successMessage, 400),
    errorMessage: sanitizeText(input.errorMessage, defaultUnsubscribeSettings.errorMessage, 220),
    captchaEnabled: Boolean(input.captchaEnabled ?? defaultUnsubscribeSettings.captchaEnabled),
    captchaExpiryMinutes: Math.max(1, Math.min(60, Number(input.captchaExpiryMinutes ?? defaultUnsubscribeSettings.captchaExpiryMinutes))),
    maxAttempts: Math.max(1, Math.min(20, Number(input.maxAttempts ?? defaultUnsubscribeSettings.maxAttempts))),
    allowManualEmailInput: Boolean(input.allowManualEmailInput ?? defaultUnsubscribeSettings.allowManualEmailInput),
    requireToken: Boolean(input.requireToken ?? defaultUnsubscribeSettings.requireToken),
    removeFromAllLists: Boolean(input.removeFromAllLists ?? defaultUnsubscribeSettings.removeFromAllLists),
    addToSuppression: Boolean(input.addToSuppression ?? defaultUnsubscribeSettings.addToSuppression),
    suppressionReason: sanitizeText(input.suppressionReason, defaultUnsubscribeSettings.suppressionReason, 120),
    footerText: sanitizeText(input.footerText, defaultUnsubscribeSettings.footerText, 220)
  };
}

export async function getUnsubscribeSettings(): Promise<UnsubscribeSettings> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: UNSUBSCRIBE_SETTINGS_KEY } });
    const value = (row?.value as Partial<UnsubscribeSettings> | null) ?? {};
    return sanitizeUnsubscribeSettings({ ...defaultUnsubscribeSettings, ...value });
  } catch {
    return defaultUnsubscribeSettings;
  }
}

