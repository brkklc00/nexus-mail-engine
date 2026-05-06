import { Suspense } from "react";
import Image from "next/image";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="relative min-h-[75vh] overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-zinc-950 to-zinc-900/70 p-6 md:p-10">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-24 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="relative mx-auto mt-8 max-w-md rounded-2xl border border-zinc-800/80 bg-zinc-950/90 p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <Image
            src="https://i.ibb.co/gLk7x7JD/nexus-logo-1.png"
            alt="Nexus"
            width={36}
            height={36}
            unoptimized
          />
          <div>
            <h2 className="text-lg font-semibold text-white">Nexus Yönetici Girişi</h2>
            <p className="text-xs text-zinc-400">Güvenli yönetim paneline erişim</p>
          </div>
        </div>
        <div>
          <Suspense fallback={<p className="text-sm text-zinc-400">Giris yukleniyor...</p>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
