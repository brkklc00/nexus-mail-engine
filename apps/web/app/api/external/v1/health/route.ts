import { NextResponse, type NextRequest } from "next/server";
import { authorizeExternalRequest, externalOptions } from "../_lib";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return externalOptions(req);
}

export async function GET(req: NextRequest) {
  const auth = await authorizeExternalRequest(req);
  if (!auth.ok) return auth.response!;
  return NextResponse.json(
    {
      ok: true,
      service: "nexus-mail-engine-external-api",
      version: process.env.APP_VERSION ?? "v1",
      timestamp: new Date().toISOString()
    },
    { headers: auth.corsHeaders }
  );
}

