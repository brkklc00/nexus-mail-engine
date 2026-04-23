import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

type KeySpec = {
  version: string;
  key: Buffer;
};

function normalizeKey(secret: string): Buffer {
  const raw = secret.trim();
  if (raw.startsWith("base64:")) {
    return Buffer.from(raw.slice(7), "base64");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function parseKeyRing(): KeySpec[] {
  const current = process.env.SMTP_SECRET_KEY;
  if (!current) {
    throw new Error("SMTP_SECRET_KEY is required");
  }
  const currentVersion = process.env.SMTP_SECRET_KEY_VERSION ?? "v1";
  const keys: KeySpec[] = [{ version: currentVersion, key: normalizeKey(current) }];

  const previous = process.env.SMTP_SECRET_KEY_PREVIOUS;
  if (previous) {
    const prevVersion = process.env.SMTP_SECRET_KEY_PREVIOUS_VERSION ?? "v0";
    keys.push({ version: prevVersion, key: normalizeKey(previous) });
  }
  return keys;
}

export function getCurrentSecretVersion(): string {
  return process.env.SMTP_SECRET_KEY_VERSION ?? "v1";
}

export function encryptSmtpSecret(plainText: string): string {
  const [{ version, key }] = parseKeyRing();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${version}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSmtpSecret(cipherText: string): string {
  const [version, ivB64, tagB64, dataB64] = cipherText.split(":");
  if (!version || !ivB64 || !tagB64 || !dataB64) {
    // Backward compatibility for legacy plain values.
    return cipherText;
  }

  const keyring = parseKeyRing();
  const spec = keyring.find((entry) => entry.version === version) ?? keyring[0];
  const decipher = crypto.createDecipheriv(ALGO, spec.key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

export function isEncryptedSecret(value: string): boolean {
  return value.split(":").length === 4;
}

export function getSecretVersion(value: string): string | null {
  if (!isEncryptedSecret(value)) {
    return null;
  }
  return value.split(":")[0] ?? null;
}
