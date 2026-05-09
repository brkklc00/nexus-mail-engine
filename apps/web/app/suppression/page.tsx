import { PageHeader } from "@/components/ui/page-header";
import { SuppressionManager } from "@/components/suppression/suppression-manager";

export const dynamic = "force-dynamic";

export default async function SuppressionPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Baskılama / Kara Liste"
        description="İstatistikler, arama odaklı listeleme ve senkronizasyon kontrolleriyle ölçeklenebilir baskılama yönetimi."
        action={<span className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">Baskılamayı yönet</span>}
      />
      <SuppressionManager />
    </div>
  );
}
