import { NextResponse, type NextRequest } from "next/server";
import { authorizeExternalRequest, externalOptions } from "../../_lib";
import { externalCampaignSchema, startExternalCampaign } from "../../_service";

function mapError(error: unknown): { status: number; code: string } {
  const message = error instanceof Error ? error.message : "campaign_start_failed";
  if (message === "template_not_found") return { status: 404, code: "template_not_found" };
  if (message === "target_not_found") return { status: 404, code: "target_not_found" };
  if (message === "no_recipients") return { status: 400, code: "no_recipients" };
  if (message === "no_smtp_accounts") return { status: 400, code: "no_smtp_accounts" };
  return { status: 500, code: "campaign_start_failed" };
}

export async function OPTIONS(req: NextRequest) {
  return externalOptions(req);
}

export async function POST(req: NextRequest) {
  const auth = await authorizeExternalRequest(req);
  if (!auth.ok) return auth.response!;

  const parsed = externalCampaignSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", details: parsed.error.flatten() },
      { status: 400, headers: auth.corsHeaders }
    );
  }

  try {
    const started = await startExternalCampaign(parsed.data);
    return NextResponse.json(
      {
        ok: true,
        campaignId: started.campaignId,
        status: started.status,
        estimatedTargetCount: started.estimatedTargetCount,
        selectedSmtpCount: started.selectedSmtpCount,
        rotateEvery: started.rotateEvery,
        parallelSmtpCount: started.parallelSmtpCount
      },
      { headers: auth.corsHeaders }
    );
  } catch (error) {
    const mapped = mapError(error);
    return NextResponse.json(
      { ok: false, error: mapped.code },
      { status: mapped.status, headers: auth.corsHeaders }
    );
  }
}

