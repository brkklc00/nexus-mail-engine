import { NextResponse, type NextRequest } from "next/server";
import { getRedisClient } from "@nexus/queue";

const EXTERNAL_RATE_LIMIT_PER_MINUTE = 60;
const EXTERNAL_RATE_LIMIT_WINDOW_MS = 60_000;
const localRateState = new Map<string, { count: number; resetAt: number }>();

type ExternalAuthResult = {
  ok: boolean;
  response?: NextResponse;
  corsHeaders: Record<string, string>;
  requesterIp: string;
};

export function resolveAllowedOrigins(): string[] {
  return (process.env.EXTERNAL_API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveOriginHeader(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  return origin.trim();
}

function buildCorsHeaders(req: NextRequest): Record<string, string> {
  const allowed = resolveAllowedOrigins();
  const origin = resolveOriginHeader(req);
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "600"
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function isOriginAllowed(req: NextRequest): boolean {
  const origin = resolveOriginHeader(req);
  if (!origin) return true;
  const allowed = resolveAllowedOrigins();
  if (allowed.length === 0) return false;
  return allowed.includes(origin);
}

function getRequesterIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

function unauthorized(corsHeaders: Record<string, string>) {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: corsHeaders });
}

function forbiddenOrigin(corsHeaders: Record<string, string>) {
  return NextResponse.json({ ok: false, error: "forbidden_origin" }, { status: 403, headers: corsHeaders });
}

function tooManyRequests(corsHeaders: Record<string, string>) {
  return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: corsHeaders });
}

async function checkRateLimit(key: string): Promise<boolean> {
  try {
    const result = await getRedisClient().eval(
      `
        local current = redis.call("INCR", KEYS[1])
        if current == 1 then
          redis.call("PEXPIRE", KEYS[1], ARGV[1])
        end
        return current
      `,
      1,
      key,
      String(EXTERNAL_RATE_LIMIT_WINDOW_MS)
    );
    return Number(result) <= EXTERNAL_RATE_LIMIT_PER_MINUTE;
  } catch {
    const now = Date.now();
    const existing = localRateState.get(key);
    if (!existing || now >= existing.resetAt) {
      localRateState.set(key, { count: 1, resetAt: now + EXTERNAL_RATE_LIMIT_WINDOW_MS });
      return true;
    }
    existing.count += 1;
    return existing.count <= EXTERNAL_RATE_LIMIT_PER_MINUTE;
  }
}

export async function authorizeExternalRequest(req: NextRequest): Promise<ExternalAuthResult> {
  const corsHeaders = buildCorsHeaders(req);
  const requesterIp = getRequesterIp(req);
  if (!isOriginAllowed(req)) {
    return { ok: false, response: forbiddenOrigin(corsHeaders), corsHeaders, requesterIp };
  }

  const configuredApiKey = process.env.EXTERNAL_API_KEY ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!configuredApiKey || !token || token !== configuredApiKey) {
    return { ok: false, response: unauthorized(corsHeaders), corsHeaders, requesterIp };
  }

  const limited = await checkRateLimit(`external_api:${configuredApiKey}:${requesterIp}`);
  if (!limited) {
    return { ok: false, response: tooManyRequests(corsHeaders), corsHeaders, requesterIp };
  }

  return { ok: true, corsHeaders, requesterIp };
}

export function externalOptions(req: NextRequest): NextResponse {
  const corsHeaders = buildCorsHeaders(req);
  if (!isOriginAllowed(req)) {
    return forbiddenOrigin(corsHeaders);
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

