"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems: Array<{ href: Route; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/templates", label: "Templates" },
  { href: "/lists", label: "Lists" },
  { href: "/segments", label: "Segments" },
  { href: "/send", label: "Send" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/settings/smtp", label: "SMTP" },
  { href: "/suppression", label: "Suppression" },
  { href: "/logs", label: "Logs" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") {
    return <main className="p-6">{children}</main>;
  }

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr]">
      <aside className="border-r border-border bg-panel p-5">
        <div className="mb-8 flex items-center gap-3">
          <Image
            src="https://i.ibb.co/gLk7x7JD/nexus-logo-1.png"
            alt="Nexus"
            width={32}
            height={32}
            unoptimized
          />
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-400">Operations</p>
            <h1 className="text-xl font-semibold text-white">Nexus</h1>
          </div>
        </div>
        <nav className="space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          className="mt-6 w-full rounded-md border border-border px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
          }}
        >
          Logout
        </button>
      </aside>
      <main className="p-6">{children}</main>
    </div>
  );
}
