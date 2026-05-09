"use client";

import { useEffect, useMemo, useState } from "react";

type PublicConfig = {
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
  footerText: string;
};

const defaultConfig: PublicConfig = {
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
  footerText: ""
};

export function PublicUnsubscribePage({ initialToken }: { initialToken?: string | null }) {
  const [config, setConfig] = useState<PublicConfig>(defaultConfig);
  const [email, setEmail] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);

  async function refreshCaptcha() {
    try {
      const response = await fetch("/api/unsubscribe/captcha", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        captchaId?: string;
        imageDataUrl?: string | null;
      };
      if (!response.ok || !payload.ok) {
        throw new Error("Captcha yüklenemedi");
      }
      setCaptchaId(String(payload.captchaId ?? ""));
      setCaptchaImage(payload.imageDataUrl ?? null);
      setCaptchaCode("");
    } catch {
      setError("Doğrulama kodu yüklenemedi. Lütfen tekrar deneyin.");
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const tokenQuery = initialToken ? `?token=${encodeURIComponent(initialToken)}` : "";
        const response = await fetch(`/api/unsubscribe/config${tokenQuery}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          enabled?: boolean;
          title?: string;
          description?: string;
          successMessage?: string;
          errorMessage?: string;
          captchaEnabled?: boolean;
          captchaExpiryMinutes?: number;
          maxAttempts?: number;
          allowManualEmailInput?: boolean;
          requireToken?: boolean;
          footerText?: string;
          prefilledEmail?: string | null;
          tokenValid?: boolean;
        };
        if (!response.ok || !payload.ok) {
          throw new Error("Ayarlar yüklenemedi");
        }
        setConfig((prev) => ({
          ...prev,
          enabled: Boolean(payload.enabled ?? prev.enabled),
          title: String(payload.title ?? prev.title),
          description: String(payload.description ?? prev.description),
          successMessage: String(payload.successMessage ?? prev.successMessage),
          errorMessage: String(payload.errorMessage ?? prev.errorMessage),
          captchaEnabled: Boolean(payload.captchaEnabled ?? prev.captchaEnabled),
          captchaExpiryMinutes: Number(payload.captchaExpiryMinutes ?? prev.captchaExpiryMinutes),
          maxAttempts: Number(payload.maxAttempts ?? prev.maxAttempts),
          allowManualEmailInput: Boolean(payload.allowManualEmailInput ?? prev.allowManualEmailInput),
          requireToken: Boolean(payload.requireToken ?? prev.requireToken),
          footerText: String(payload.footerText ?? prev.footerText)
        }));
        if (payload.prefilledEmail) {
          setEmail(payload.prefilledEmail);
        }
        setTokenValid(Boolean(payload.tokenValid));
        if (Boolean(payload.captchaEnabled ?? true)) {
          await refreshCaptcha();
        } else {
          setCaptchaId("disabled");
          setCaptchaImage(null);
        }
      } catch {
        setError("Sayfa yüklenemedi.");
      } finally {
        setLoading(false);
      }
    })();
  }, [initialToken]);

  const emailLocked = useMemo(() => tokenValid, [tokenValid]);
  const canSubmit = useMemo(() => {
    if (!config.enabled) return false;
    if (config.requireToken && !initialToken) return false;
    if (!tokenValid && !config.allowManualEmailInput) return false;
    if (!email.trim() && (config.allowManualEmailInput || !tokenValid)) return false;
    if (config.captchaEnabled && (!captchaId || !captchaCode.trim())) return false;
    return true;
  }, [captchaCode, captchaId, config.allowManualEmailInput, config.captchaEnabled, config.enabled, config.requireToken, email, initialToken, tokenValid]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/unsubscribe/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          token: initialToken ?? undefined,
          captchaId,
          captchaCode
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? config.errorMessage);
      }
      setMessage(payload.message ?? "E-posta adresiniz isleme alindi.");
      setCaptchaCode("");
      if (config.captchaEnabled) {
        await refreshCaptcha();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : config.errorMessage);
      if (config.captchaEnabled) {
        await refreshCaptcha();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-4">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-sm text-zinc-300">
          Yükleniyor...
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-white">{config.title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{config.description}</p>

        {!config.enabled ? (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            Bu sayfa şu anda kullanıma kapalı.
          </p>
        ) : null}
        {config.requireToken && !initialToken ? (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            Bu işlem için geçerli bir abonelikten çık tokeni gerekir.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">E-posta adresi</span>
            <input
              type="email"
              className="w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!config.allowManualEmailInput || emailLocked}
              placeholder="ornek@alanadi.com"
            />
          </label>

          {config.captchaEnabled ? (
            <div className="space-y-2 rounded-lg border border-border bg-zinc-900/40 p-3">
              <p className="text-xs text-zinc-400">Resimli doğrulama kodu</p>
              {captchaImage ? (
                <img src={captchaImage} alt="Doğrulama kodu" className="h-16 w-full rounded-md border border-border object-contain" />
              ) : null}
              <input
                className="w-full rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                value={captchaCode}
                onChange={(event) => setCaptchaCode(event.target.value.toUpperCase())}
                placeholder="Doğrulama kodu"
                maxLength={8}
              />
              <button type="button" onClick={() => void refreshCaptcha()} className="text-xs text-indigo-300 hover:text-indigo-200">
                Kodu Yenile
              </button>
            </div>
          ) : null}
        </div>

        {message ? (
          <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            <p>{config.successMessage}</p>
            <p className="mt-1 text-xs text-emerald-100/90">{message}</p>
          </div>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit || submitting}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "İşleniyor..." : "Abonelikten Çık"}
        </button>

        {config.footerText ? <p className="mt-4 text-center text-xs text-zinc-500">{config.footerText}</p> : null}
      </div>
    </main>
  );
}

