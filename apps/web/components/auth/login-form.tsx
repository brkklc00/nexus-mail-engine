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
    nextValue.startsWith("/api") ||
    nextValue.startsWith("/_next") ||
    nextValue.startsWith("/track") ||
    nextValue.startsWith("/unsubscribe")
  ) {
    return FALLBACK_ROUTE;
  }

  return nextValue as Route;
}

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { email: "", password: "" }
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Login failed");
      return;
    }
    router.push(sanitizeNextRoute(search.get("next")));
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Email</label>
        <input
          type="email"
          className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-white"
          {...register("email", { required: true })}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-400">Password</label>
        <input
          type="password"
          className="w-full rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-white"
          {...register("password", { required: true })}
        />
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={formState.isSubmitting}
        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {formState.isSubmitting ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
