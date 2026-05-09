import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

type SmtpSummary = {
  id: string;
  name: string;
  isThrottled: boolean;
  throttleReason: string | null;
  providerLabel: string | null;
};

export function SmtpHealthSummary({
  smtpTotals,
  smtpStates
}: {
  smtpTotals: {
    total: number;
    healthy: number;
    throttled: number;
    error: number;
  };
  smtpStates: SmtpSummary[];
}) {
  return (
    <div className="flex h-full min-h-[460px] max-h-[650px] flex-col rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-medium text-zinc-200">SMTP Sağlığı</h3>
        </div>
        <Link href="/settings/smtp" className="rounded border border-border px-2 py-1 text-xs text-zinc-300">
          Tüm SMTP'leri gör
        </Link>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-zinc-300">Toplam: {smtpTotals.total}</div>
        <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-emerald-300">Sağlıklı: {smtpTotals.healthy}</div>
        <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-amber-300">Sınırlandı: {smtpTotals.throttled}</div>
        <div className="rounded-lg border border-border bg-zinc-900/60 px-2 py-1.5 text-rose-300">Hata: {smtpTotals.error}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {smtpStates.length === 0 ? (
          <EmptyState
            icon="chart-bar"
            title="SMTP hesabı bulunamadı"
            description="Hesaplar eklendikten sonra SMTP sağlık ve sınırlandırma durumu burada görünür."
          />
        ) : (
          <div className="space-y-1.5">
            {smtpStates.map((smtp) => (
              <div key={smtp.id} className="rounded-xl border border-border bg-zinc-900/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-white">{smtp.name}</p>
                  <StatusBadge
                    label={smtp.isThrottled ? "throttled" : "healthy"}
                    tone={smtp.isThrottled ? "warning" : "success"}
                  />
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-400">
                  Sağlayıcı: {smtp.providerLabel ?? "özel"} · {smtp.throttleReason ?? "Aktif sınırlandırma yok"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
