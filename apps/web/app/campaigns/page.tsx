import { CampaignOperations } from "@/components/campaigns/campaign-operations";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Campaigns"
        description="Canli kampanya operasyonu, queue izleme, analytics, raporlama ve durum bazli aksiyonlar."
      />
      <CampaignOperations />
    </div>
  );
}
