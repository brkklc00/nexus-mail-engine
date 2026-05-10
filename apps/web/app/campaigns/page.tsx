import { CampaignOperations } from "@/components/campaigns/campaign-operations";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black">
      <CampaignOperations />
    </div>
  );
}
