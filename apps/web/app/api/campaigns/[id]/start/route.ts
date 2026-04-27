import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { startCampaign } from "@/server/campaigns/orchestration.service";

function mapStartError(error: unknown): { status: number; error: string; code: string } {
  const message = error instanceof Error ? error.message : "campaign_start_failed";
  if (message === "campaign_not_found") return { status: 404, code: message, error: "Campaign was not found." };
  if (message === "campaign_state_invalid") return { status: 409, code: message, error: "Campaign cannot be started in the current state." };
  if (message === "campaign_list_required") return { status: 400, code: message, error: "A recipient list is required for this campaign." };
  if (message === "campaign_target_required") return { status: 400, code: message, error: "Campaign target is required." };
  if (message === "segment_query_missing") return { status: 400, code: message, error: "Segment query was not found." };
  if (message === "smtp_pool_empty" || message === "no_smtp_accounts") {
    return { status: 400, code: "no_smtp_accounts", error: "No active SMTP accounts available for this campaign." };
  }
  if (message === "campaign_import_failed" || message === "db_insert_failed") {
    return { status: 500, code: "db_insert_failed", error: "Campaign recipients could not be inserted." };
  }
  if (message === "no_recipients") {
    return { status: 400, code: "no_recipients", error: "No recipients found for selected campaign target." };
  }
  if (message === "campaign_queue_failed" || message === "queue_unavailable") {
    return { status: 502, code: "queue_unavailable", error: "Campaign queue is unavailable." };
  }
  if (message === "lock_not_acquired") return { status: 409, code: message, error: "Campaign start process is already running." };
  return { status: 400, code: "campaign_start_failed", error: "Campaign could not be started. Check logs for details." };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const campaign = await startCampaign(id);
    await writeAuditLog(session.userId, "campaign.start", "campaign", { campaignId: id });
    return NextResponse.json({ campaign });
  } catch (error) {
    const mapped = mapStartError(error);
    return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
}
