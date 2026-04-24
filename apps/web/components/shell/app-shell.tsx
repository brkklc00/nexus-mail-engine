"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  LogOut,
  Mail,
  Megaphone,
  Send,
  ServerCog,
  ShieldBan,
  SlidersHorizontal
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems: Array<{ href: Route; label: string; icon: LucideIcon }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/templates", label: "Templates", icon: Mail },
  { href: "/lists", label: "Lists", icon: ListChecks },
  { href: "/segments", label: "Segments", icon: SlidersHorizontal },
  { href: "/send", label: "Send", icon: Send },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/settings/smtp", label: "SMTP", icon: ServerCog },
  { href: "/suppression", label: "Suppression", icon: ShieldBan },
  { href: "/logs", label: "Logs", icon: Activity }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") {
    return <main className="p-6">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="group fixed inset-y-0 left-0 z-40 flex w-20 flex-col border-r border-border/70 bg-panel/95 p-3 shadow-[0_0_30px_rgba(0,0,0,0.35)] backdrop-blur transition-all duration-300 hover:w-64 md:w-24 md:hover:w-64">
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-border/70 bg-zinc-900/70 p-2">
          <Image
            src="https://i.ibb.co/gLk7x7JD/nexus-logo-1.png"
            alt="Nexus"
            width={30}
            height={30}
            unoptimized
          />
          <div className="hidden min-w-0 opacity-0 transition group-hover:block group-hover:opacity-100 md:group-hover:block">
            <p className="truncate text-[10px] uppercase tracking-[0.2em] text-zinc-500">Operations</p>
            <h1 className="truncate text-sm font-semibold text-white">Nexus Control</h1>
          </div>
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-zinc-900/90 hover:text-white",
                pathname === item.href
                  ? "border border-indigo-400/40 bg-indigo-500/10 text-indigo-100 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]"
                  : "border border-transparent"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="hidden whitespace-nowrap opacity-0 transition group-hover:block group-hover:opacity-100 md:group-hover:block">
                {item.label}
              </span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-zinc-900/70 px-3 py-2.5 text-sm text-zinc-300 transition hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="hidden opacity-0 transition group-hover:block group-hover:opacity-100 md:group-hover:block">
              Logout
            </span>
          </button>
        </div>
      </aside>
      <main className="w-full pl-20 transition-all md:pl-24">
        <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
