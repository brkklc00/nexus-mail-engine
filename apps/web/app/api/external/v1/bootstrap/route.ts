import { NextResponse, type NextRequest } from "next/server";
import { authorizeExternalRequest, externalOptions } from "../_lib";
import { getSafeRecipientLists, getSafeTemplateList, getSmtpPoolSummary } from "../_service";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return externalOptions(req);
}

export async function GET(req: NextRequest) {
  const auth = await authorizeExternalRequest(req);
  if (!auth.ok) return auth.response!;

  const [templates, recipientLists, smtp] = await Promise.all([
    getSafeTemplateList(),
    getSafeRecipientLists(),
    getSmtpPoolSummary()
  ]);

  return NextResponse.json(
    {
      ok: true,
      templates,
      recipientLists,
      smtpPool: smtp.summary,
      poolSettings: smtp.poolSettings,
      defaults: smtp.defaults
    },
    { headers: auth.corsHeaders }
  );
}

