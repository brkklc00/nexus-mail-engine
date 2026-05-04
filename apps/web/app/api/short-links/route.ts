import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { createShortLink, listShortLinks, normalizeShortLinkPayload } from "@/server/short-links/nxusurl.service";

const createSchema = z.object({
  location_url: z.string().min(1),
  url: z.string().optional(),
  domain_id: z.number().int().optional(),
  project_id: z.number().int().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  forward_query_parameters_is_enabled: z.boolean().optional(),
  http_status_code: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional()
});

function toHttpStatus(code: string) {
  if (code === "shortener_not_configured") return 503;
  if (code === "shortener_auth_failed") return 401;
  if (code === "invalid_destination_url") return 400;
  if (code === "duplicate_alias") return 409;
  if (code === "link_not_found") return 404;
  return 502;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const payload = await listShortLinks(url.searchParams);
    return NextResponse.json({ ok: true, ...normalizeShortLinkPayload(payload) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "shortener_api_failed";
    return NextResponse.json({ ok: false, code, error: code }, { status: toHttpStatus(code) });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "invalid_destination_url", error: "Invalid payload" }, { status: 400 });
  }
  try {
    const payload = await createShortLink(parsed.data, {
      templateId: null,
      campaignId: null
    });
    return NextResponse.json({ ok: true, ...normalizeShortLinkPayload(payload) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "shortener_api_failed";
    return NextResponse.json({ ok: false, code, error: code }, { status: toHttpStatus(code) });
  }
}

