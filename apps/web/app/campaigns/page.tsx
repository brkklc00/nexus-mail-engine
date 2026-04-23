import { prisma } from "@nexus/db";
import { CampaignTable } from "@/components/campaigns/campaign-table";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-semibold text-white">Campaigns</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Multi-campaign monitoring with fairness scheduling and pause/resume/cancel controls.
        </p>
      </div>
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
    </div>
  );
}
