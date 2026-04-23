import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/health",
  "/track/open",
  "/track/click",
  "/unsubscribe"
];

function base64UrlToUint8Array(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifySession(raw: string): Promise<boolean> {
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) {
    return false;
  }
  const secret = process.env.AUTH_SECRET ?? process.env.TRACKING_SECRET ?? "dev-secret-change-me";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToUint8Array(signature),
    new TextEncoder().encode(encoded)
  );
  if (!verified) {
    return false;
  }
  const payloadText = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const payload = JSON.parse(payloadText) as { exp?: number };
  return Boolean(payload.exp && payload.exp > Date.now());
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  const raw = req.cookies.get("nexus_session")?.value;
  if (!raw || !(await verifySession(raw))) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
