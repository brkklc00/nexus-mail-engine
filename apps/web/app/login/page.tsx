import { Suspense } from "react";
import Image from "next/image";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="relative h-[100dvh] min-h-[100dvh] w-full overflow-hidden bg-gradient-to-b from-[#090c12] via-[#0b0f16] to-[#090b11]">
      <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-indigo-400/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.04),transparent_55%)]" />

      <div className="flex h-full w-full items-center justify-center px-4 py-6 sm:px-6">
        <div className="relative w-full max-w-md rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-6">
          <div className="mb-5 flex items-center gap-4 rounded-xl border border-zinc-800/90 bg-zinc-900/70 p-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700/70 bg-zinc-900">
              <Image
                src="https://i.ibb.co/gLk7x7JD/nexus-logo-1.png"
                alt="Nexus"
                width={24}
                height={24}
                unoptimized
              />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-white">Nexus Yönetici Girişi</h2>
              <p className="mt-1 text-sm text-zinc-400">Yönetim paneline güvenli erişim</p>
            </div>
          </div>

          <Suspense fallback={<p className="text-sm text-zinc-400">Giriş yükleniyor...</p>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
