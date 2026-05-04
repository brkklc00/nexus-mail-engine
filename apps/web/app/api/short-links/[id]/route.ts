import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { deleteShortLink, getShortLink, normalizeShortLinkPayload, updateShortLink } from "@/server/short-links/nxusurl.service";

const updateSchema = z.object({
  location_url: z.string().optional(),
  url: z.string().optional(),
  domain_id: z.number().int().optional(),
  project_id: z.number().int().optional(),
  is_enabled: z.boolean().optional(),
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const payload = await getShortLink(id);
    return NextResponse.json({ ok: true, ...normalizeShortLinkPayload(payload) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "shortener_api_failed";
    return NextResponse.json({ ok: false, code, error: code }, { status: toHttpStatus(code) });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "invalid_destination_url", error: "Invalid payload" }, { status: 400 });
  }
  try {
    const { id } = await params;
    const payload = await updateShortLink(id, parsed.data);
    return NextResponse.json({ ok: true, ...normalizeShortLinkPayload(payload) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "shortener_api_failed";
    return NextResponse.json({ ok: false, code, error: code }, { status: toHttpStatus(code) });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const payload = await deleteShortLink(id);
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    const code = error instanceof Error ? error.message : "shortener_api_failed";
    return NextResponse.json({ ok: false, code, error: code }, { status: toHttpStatus(code) });
  }
}

