import crypto from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "nexus_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

type SessionPayload = {
  userId: string;
  email: string;
  role: string;
  exp: number;
};

function getSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.TRACKING_SECRET ?? "dev-secret-change-me";
}

function sign(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
}

function encode(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function decode(token: string): SessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }
  const expected = sign(encoded);
  if (expected !== signature) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  if (Date.now() > payload.exp) {
    return null;
  }
  return payload;
}

export async function createSessionCookie(user: { id: string; email: string; role: string }) {
  const store = await cookies();
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS
  };
  store.set(SESSION_COOKIE, encode(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) {
    return null;
  }
  return decode(raw);
}

export const sessionCookieName = SESSION_COOKIE;
