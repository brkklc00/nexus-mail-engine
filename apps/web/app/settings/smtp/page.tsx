import { PlusCircle, ServerCog } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function SmtpSettingsPage() {
  const accounts = await prisma.smtpAccount.findMany({
    where: { isSoftDeleted: false },
    orderBy: { createdAt: "desc" },
    include: {
      warmupStats: {
        orderBy: { date: "desc" },
        take: 1
      }
    }
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="SMTP Accounts"
        description="Provider, warmup tier, throttle state ve health ozetleri."
        action={
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-500"
          >
            <PlusCircle className="h-4 w-4" />
            Add SMTP
          </button>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon="server"
          title="SMTP hesabi yok"
          description="Yeni bir SMTP hesabı eklendiginde warmup ve saglik durumlari burada gorunecek."
          ctaLabel="Add SMTP account"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {accounts.map((account: any) => {
            const latest = account.warmupStats[0];
            return (
              <article key={account.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{account.name}</h3>
                    <p className="mt-1 text-xs text-zinc-400">
                      {account.host}:{account.port} · {account.encryption.toUpperCase()} · {account.providerLabel ?? "custom"}
                    </p>
                  </div>
                  <StatusBadge
                    label={account.isThrottled ? "throttled" : "healthy"}
                    tone={account.isThrottled ? "warning" : "success"}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Target RPS" value={account.targetRatePerSecond} />
                  <Stat label="Max RPS" value={account.maxRatePerSecond ?? "-"} />
                  <Stat label="Warmup tier" value={latest?.tierName ?? "n/a"} />
                  <Stat label="Deliveries today" value={latest?.successfulDeliveries ?? 0} />
                </div>

                <p className="mt-3 text-xs text-zinc-400">
                  {account.throttleReason ?? "No active throttle reason"} · Updated{" "}
                  {new Date(account.updatedAt).toLocaleString()}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-zinc-900/60 p-2 text-zinc-300">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="pt-1 text-sm font-medium text-white">{value}</p>
    </div>
  );
}
