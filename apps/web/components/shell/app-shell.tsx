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
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/utils";

const navItems: Array<{ href: Route; labelKey: string; icon: LucideIcon }> = [
  { href: "/dashboard", labelKey: "shell.nav.dashboard", icon: LayoutDashboard },
  { href: "/templates", labelKey: "shell.nav.templates", icon: Mail },
  { href: "/lists", labelKey: "shell.nav.lists", icon: ListChecks },
  { href: "/segments", labelKey: "shell.nav.segments", icon: SlidersHorizontal },
  { href: "/send", labelKey: "shell.nav.send", icon: Send },
  { href: "/campaigns", labelKey: "shell.nav.campaigns", icon: Megaphone },
  { href: "/settings/smtp", labelKey: "shell.nav.smtp", icon: ServerCog },
  { href: "/suppression", labelKey: "shell.nav.suppression", icon: ShieldBan },
  { href: "/logs", labelKey: "shell.nav.logs", icon: Activity }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();

  if (pathname === "/login") {
    return <main className="p-6">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[76px] flex-col border-r border-border/50 bg-[#0d1119] p-3 shadow-[0_0_24px_rgba(0,0,0,0.3)]">
        <div className="mb-6 flex items-center justify-center rounded-xl border border-border/60 bg-zinc-900/70 p-2">
          <Image
            src="https://i.ibb.co/gLk7x7JD/nexus-logo-1.png"
            alt="Nexus"
            width={30}
            height={30}
            unoptimized
          />
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={t(item.labelKey)}
              className={cn(
                "group/nav relative flex items-center justify-center rounded-xl px-3 py-2.5 text-sm text-zinc-400 transition-all duration-200 hover:bg-zinc-900/90 hover:text-white",
                pathname === item.href
                  ? "bg-indigo-500/15 text-indigo-100"
                  : ""
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="pointer-events-none absolute left-[56px] top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 shadow-lg group-hover/nav:block">
                {t(item.labelKey)}
              </span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-2 px-1">
            <LanguageSwitcher />
          </div>
          <button
            type="button"
            title={t("shell.logout")}
            className="group/nav relative flex w-full items-center justify-center rounded-xl border border-border bg-zinc-900/70 px-3 py-2.5 text-sm text-zinc-300 transition hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="pointer-events-none absolute left-[56px] top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 shadow-lg group-hover/nav:block">
              {t("shell.logout")}
            </span>
          </button>
        </div>
      </aside>
      <main className="w-full pl-[76px]">
        <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
