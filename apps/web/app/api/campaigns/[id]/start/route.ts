import { NextResponse } from "next/server";
import { campaignQueue } from "@nexus/queue";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { startCampaign } from "@/server/campaigns/orchestration.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const campaign = await startCampaign(id);
    await campaignQueue.add(
      "campaign_start",
      { campaignId: id, trigger: "manual" },
      { jobId: `campaign_start:${id}` }
    );
    await writeAuditLog(session.userId, "campaign.start", "campaign", { campaignId: id });
    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
