import { PageHeader } from "@/components/ui/page-header";
import { SuppressionManager } from "@/components/suppression/suppression-manager";

export const dynamic = "force-dynamic";

export default async function SuppressionPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Baskilama / Kara Liste"
        description="Istatistikler, arama odakli listeleme ve senkronizasyon kontrolleriyle olceklenebilir baskilama yonetimi."
        action={<span className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">Baskilamayi yonet</span>}
      />
      <SuppressionManager />
    </div>
  );
}
