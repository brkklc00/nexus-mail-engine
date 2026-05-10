import { CampaignOperations } from "@/components/campaigns/campaign-operations";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  return (
    <div className="min-h-screen bg-[#080B12] bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(79,70,229,0.14),transparent_55%),radial-gradient(ellipse_80%_50%_at_100%_0%,rgba(139,92,246,0.08),transparent_45%)]">
      <CampaignOperations />
    </div>
  );
}
