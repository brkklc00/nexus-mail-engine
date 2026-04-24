import { prisma } from "@nexus/db";
import { CampaignTable } from "@/components/campaigns/campaign-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Megaphone } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campaigns"
        description="Canli kampanya durumu, teslimat metrikleri ve orkestrasyon aksiyonlari."
      />
      {campaigns.length === 0 ? (
        <EmptyState
          icon="megaphone"
          title="Kampanya bulunamadi"
          description="Send ekranindan yeni bir kampanya baslattiginda burada listelenecek."
        />
      ) : (
        <CampaignTable
          campaigns={campaigns.map((c: any) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            totalTargeted: c.totalTargeted,
            totalSent: c.totalSent,
            totalFailed: c.totalFailed,
            createdAt: c.createdAt.toISOString()
          }))}
        />
      )}
    </div>
  );
}
