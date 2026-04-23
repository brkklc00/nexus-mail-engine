import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { cancelCampaign } from "@/server/campaigns/orchestration.service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await cancelCampaign(id);
    await writeAuditLog(session.userId, "campaign.cancel", "campaign", { campaignId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
