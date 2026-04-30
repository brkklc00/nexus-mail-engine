import { NextResponse, type NextRequest } from "next/server";
import { authorizeExternalRequest, externalOptions } from "../_lib";
import { getSafeTemplateList } from "../_service";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return externalOptions(req);
}

export async function GET(req: NextRequest) {
  const auth = await authorizeExternalRequest(req);
  if (!auth.ok) return auth.response!;
  const templates = await getSafeTemplateList({ onlyActive: true });
  return NextResponse.json({ ok: true, templates }, { headers: auth.corsHeaders });
}

