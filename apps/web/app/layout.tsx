import type { Metadata } from "next";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { AppShell } from "@/components/shell/app-shell";
import { NotificationProvider } from "@/components/ui/notification-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus",
  description: "Nexus bulk email operations platform",
  icons: {
    icon: "https://i.ibb.co/nN2TdWjf/default-avatar.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-zinc-100">
        <I18nProvider>
          <NotificationProvider>
            <AppShell>{children}</AppShell>
          </NotificationProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
