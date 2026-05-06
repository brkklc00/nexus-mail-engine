import { CampaignOperations } from "@/components/campaigns/campaign-operations";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Kampanyalar"
        description="Canli kampanya operasyonu, kuyruk izleme, analiz, raporlama ve durum bazli islemler."
      />
      <CampaignOperations />
    </div>
  );
}
