import { NextResponse, type NextRequest } from "next/server";
import { authorizeExternalRequest, externalOptions } from "../_lib";
import { getSmtpPoolSummary } from "../_service";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return externalOptions(req);
}

export async function GET(req: NextRequest) {
  const auth = await authorizeExternalRequest(req);
  if (!auth.ok) return auth.response!;
  const smtp = await getSmtpPoolSummary();
  return NextResponse.json(
    {
      ok: true,
      smtpPool: {
        activeSmtpCount: smtp.summary.active,
        selectedUsableSmtpCount: smtp.summary.usableCount,
        healthCounts: {
          healthy: smtp.summary.healthy,
          throttled: smtp.summary.throttled
        },
        estimatedThroughput: smtp.summary.estimatedTotalRps
      },
      poolSettings: smtp.poolSettings
    },
    { headers: auth.corsHeaders }
  );
}

