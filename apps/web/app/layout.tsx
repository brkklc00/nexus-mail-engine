import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
