import crypto from "node:crypto";

type TokenPayload = {
  campaignId: string;
  recipientId: string;
  type: "open" | "click" | "unsubscribe";
  campaignLinkId?: string;
  targetUrl?: string;
  expiresAt: number;
};

function hmac(input: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

export function signTrackingToken(payload: TokenPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmac(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifyTrackingToken(token: string, secret: string): TokenPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = hmac(encoded, secret);
  if (expected !== signature) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;
  if (Date.now() > payload.expiresAt) {
    return null;
  }
  return payload;
}
