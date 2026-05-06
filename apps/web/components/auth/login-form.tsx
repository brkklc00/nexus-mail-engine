"use client";

import { useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

type FormValues = {
  email: string;
  password: string;
};

const FALLBACK_ROUTE: Route = "/dashboard";

function sanitizeNextRoute(nextValue: string | null): Route {
  if (!nextValue) {
    return FALLBACK_ROUTE;
  }

  // Allow only internal app routes and reject protocol-relative/external patterns.
  if (!nextValue.startsWith("/") || nextValue.startsWith("//") || nextValue.includes("://")) {
    return FALLBACK_ROUTE;
  }

  // Prevent redirecting into API/internal system paths.
  if (
    nextValue === "/" ||
    nextValue.startsWith("/api") ||
    nextValue.startsWith("/_next") ||
    nextValue.startsWith("/track") ||
    nextValue.startsWith("/unsubscribe") ||
    nextValue.startsWith("/login")
  ) {
    return FALLBACK_ROUTE;
  }

  return nextValue as Route;
}

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { email: "", password: "" }
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setIsPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        setError(data.error ?? "Giris basarisiz");
        return;
      }

      const safeTarget = sanitizeNextRoute(search.get("next"));
      router.replace(safeTarget);
      router.refresh();
      window.setTimeout(() => {
        window.location.href = safeTarget;
      }, 300);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Giris istegi basarisiz oldu");
    } finally {
      setIsPending(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label className="mb-2 block text-[11px] uppercase tracking-[0.16em] text-zinc-500">E-posta</label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="email"
            className="h-12 w-full rounded-xl border border-zinc-700/90 bg-zinc-900/90 py-2 pl-10 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/80 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="ornek@firma.com"
            {...register("email", { required: true })}
          />
        </div>
      </div>
      <div>
        <label className="mb-2 block text-[11px] uppercase tracking-[0.16em] text-zinc-500">Şifre</label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type={showPassword ? "text" : "password"}
            className="h-12 w-full rounded-xl border border-zinc-700/90 bg-zinc-900/90 py-2 pl-10 pr-11 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/80 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Şifrenizi girin"
            {...register("password", { required: true })}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
            title={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
            className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-900 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">Beni hatırla</span>
        <button
          type="button"
          role="switch"
          aria-checked={rememberMe}
          aria-label="Beni hatırla"
          onClick={() => setRememberMe((prev) => !prev)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${
            rememberMe ? "border-cyan-400/70 bg-cyan-400/20" : "border-zinc-700 bg-zinc-800"
          }`}
        >
          <span
            className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
              rememberMe ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      {error ? (
        <p className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={formState.isSubmitting || isPending}
        className="h-12 w-full rounded-xl border border-cyan-400/30 bg-gradient-to-r from-zinc-800 to-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-cyan-300/60 hover:from-zinc-700 hover:to-zinc-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {formState.isSubmitting || isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
      </button>
    </form>
  );
}
