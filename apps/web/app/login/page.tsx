import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-6">
      <h2 className="text-2xl font-semibold text-white">Nexus Yonetici Girisi</h2>
      <p className="mt-2 text-sm text-zinc-400">Operasyon kontrol merkezi icin guvenli oturum erisimi.</p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-400">Giris yukleniyor...</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
