"use client";

import { useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";

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
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">E-posta</label>
        <input
          type="email"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400"
          placeholder="ornek@firma.com"
          {...register("email", { required: true })}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Şifre</label>
        <div className="flex gap-2">
          <input
            type={showPassword ? "text" : "password"}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400"
            placeholder="Şifrenizi girin"
            {...register("password", { required: true })}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-xs text-zinc-300 hover:text-white"
          >
            {showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
        Beni hatirla
      </label>
      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={formState.isSubmitting || isPending}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {formState.isSubmitting || isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
      </button>
    </form>
  );
}
