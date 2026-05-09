import crypto from "node:crypto";
import { getRedisClient } from "@nexus/queue";

const CAPTCHA_KEY_PREFIX = "unsubscribe:captcha:";
const CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const localCaptchaStore = new Map<
  string,
  { codeHash: string; attempts: number; maxAttempts: number; expiresAt: number; used: boolean }
>();

function randomCode(length = 6): string {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(Math.random() * CAPTCHA_CHARS.length);
    result += CAPTCHA_CHARS[idx];
  }
  return result;
}

function hashCode(captchaId: string, code: string): string {
  const secret = process.env.AUTH_SECRET ?? process.env.TRACKING_SECRET ?? "unsubscribe-captcha-secret";
  return crypto.createHash("sha256").update(`${captchaId}:${code.toUpperCase()}:${secret}`).digest("hex");
}

function createCaptchaSvg(code: string): string {
  const width = 180;
  const height = 64;
  const chars = code.split("");
  const text = chars
    .map((char, idx) => {
      const x = 18 + idx * 26;
      const y = 40 + ((idx % 2 === 0) ? -3 : 3);
      const rotate = (Math.random() * 20 - 10).toFixed(2);
      return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" fill="#e4e4e7" font-size="28" font-family="monospace" font-weight="700">${char}</text>`;
    })
    .join("");
  const lines = Array.from({ length: 8 })
    .map(() => {
      const x1 = Math.floor(Math.random() * width);
      const x2 = Math.floor(Math.random() * width);
      const y1 = Math.floor(Math.random() * height);
      const y2 = Math.floor(Math.random() * height);
      const stroke = Math.random() > 0.5 ? "#3f3f46" : "#27272a";
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1" />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#09090b" rx="8" />
    ${lines}
    ${text}
  </svg>`;
}

export async function createCaptcha(input?: { expiryMinutes?: number; maxAttempts?: number }) {
  const captchaId = crypto.randomUUID();
  const code = randomCode(6);
  const expiryMinutes = Math.max(1, Math.min(60, Number(input?.expiryMinutes ?? 10)));
  const maxAttempts = Math.max(1, Math.min(20, Number(input?.maxAttempts ?? 5)));
  const expiresAt = Date.now() + expiryMinutes * 60_000;
  const key = `${CAPTCHA_KEY_PREFIX}${captchaId}`;
  const payload = {
    codeHash: hashCode(captchaId, code),
    attempts: "0",
    maxAttempts: String(maxAttempts),
    expiresAt: String(expiresAt),
    used: "0"
  };
  try {
    const redis = getRedisClient();
    await Promise.race([
      redis.hset(key, payload).then(async () => {
        await redis.expire(key, expiryMinutes * 60);
      }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("captcha_redis_timeout")), 1500))
    ]);
  } catch {
    localCaptchaStore.set(captchaId, {
      codeHash: payload.codeHash,
      attempts: 0,
      maxAttempts,
      expiresAt,
      used: false
    });
  }
  const svg = createCaptchaSvg(code);
  const imageDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return {
    captchaId,
    imageDataUrl,
    expiresInSeconds: expiryMinutes * 60
  };
}

export async function verifyCaptcha(captchaId: string, captchaCode: string) {
  const key = `${CAPTCHA_KEY_PREFIX}${captchaId}`;
  try {
    const redis = getRedisClient();
    const row = (await Promise.race([
      redis.hgetall(key),
      new Promise<Record<string, string>>((_resolve, reject) => setTimeout(() => reject(new Error("captcha_redis_timeout")), 1500))
    ])) as Record<string, string>;
    if (!row || !row.codeHash) {
      throw new Error("captcha_row_not_found");
    }
    const now = Date.now();
    const expiresAt = Number(row.expiresAt ?? 0);
    const attempts = Number(row.attempts ?? 0);
    const maxAttempts = Math.max(1, Number(row.maxAttempts ?? 5));
    const used = row.used === "1";
    if (used || now > expiresAt || attempts >= maxAttempts) {
      return { ok: false as const, reason: "expired_or_locked" };
    }
    const expected = row.codeHash;
    const actual = hashCode(captchaId, String(captchaCode ?? "").trim().toUpperCase());
    if (expected !== actual) {
      await redis.hset(key, { ...row, attempts: String(attempts + 1) });
      return { ok: false as const, reason: "invalid_code" };
    }
    await redis.hset(key, { ...row, used: "1" });
    return { ok: true as const };
  } catch {
    const row = localCaptchaStore.get(captchaId);
    if (!row) {
      return { ok: false as const, reason: "not_found" };
    }
    const now = Date.now();
    if (row.used || now > row.expiresAt || row.attempts >= row.maxAttempts) {
      return { ok: false as const, reason: "expired_or_locked" };
    }
    const actual = hashCode(captchaId, String(captchaCode ?? "").trim().toUpperCase());
    if (row.codeHash !== actual) {
      row.attempts += 1;
      localCaptchaStore.set(captchaId, row);
      return { ok: false as const, reason: "invalid_code" };
    }
    row.used = true;
    localCaptchaStore.set(captchaId, row);
    return { ok: true as const };
  }
}

