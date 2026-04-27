import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { startCampaign } from "@/server/campaigns/orchestration.service";

function mapStartError(error: unknown): { status: number; error: string; code: string } {
  const message = error instanceof Error ? error.message : "campaign_start_failed";
  if (message === "campaign_not_found") return { status: 404, code: message, error: "Campaign bulunamadı." };
  if (message === "campaign_state_invalid") return { status: 409, code: message, error: "Campaign bu durumda başlatılamaz." };
  if (message === "campaign_list_required") return { status: 400, code: message, error: "Campaign için bir recipient listesi gerekli." };
  if (message === "campaign_target_required") return { status: 400, code: message, error: "Campaign hedef kitlesi eksik." };
  if (message === "segment_query_missing") return { status: 400, code: message, error: "Segment query bulunamadı." };
  if (message === "smtp_pool_empty") return { status: 400, code: message, error: "Seçili SMTP havuzunda aktif SMTP yok." };
  if (message === "campaign_import_failed") return { status: 500, code: message, error: "Recipient import sırasında hata oluştu." };
  if (message === "campaign_queue_failed") return { status: 502, code: message, error: "Campaign queue işlemi başarısız oldu." };
  if (message === "lock_not_acquired") return { status: 409, code: message, error: "Campaign start işlemi zaten devam ediyor." };
  return { status: 400, code: "campaign_start_failed", error: "Campaign başlatılamadı. Lütfen logları kontrol edin." };
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
