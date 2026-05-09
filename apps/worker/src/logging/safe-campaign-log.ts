import crypto from "node:crypto";
import { prisma } from "@nexus/db";

type SafeCampaignLogInput = {
  campaignId?: string | null;
  recipientId?: string | null;
  eventType?: string | null;
  status?: "success" | "failed" | "skipped";
  providerCode?: string | null;
  message?: string | null;
  idempotencyKey?: string | null;
  metadata?: unknown;
};

let lastDuplicateLogAt = 0;

function normalizeString(value: string | null | undefined, maxLength: number) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function getMetadataField(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;
  return String(value);
}

function isDuplicateIdempotencyError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "P2002" || message.includes("Unique constraint failed") || message.includes("idempotencyKey");
}

function resolveStableIdempotencyKey(input: SafeCampaignLogInput, campaignId: string, eventType: string, status: "success" | "failed" | "skipped") {
  const explicit = normalizeString(input.idempotencyKey, 255);
  if (explicit) {
    return explicit;
  }
  const stableBase = [
    campaignId,
    normalizeString(input.recipientId, 191) ?? "no-recipient",
    eventType,
    status,
    getMetadataField(input.metadata, "jobId") ?? "",
    getMetadataField(input.metadata, "messageId") ?? "",
    getMetadataField(input.metadata, "email") ?? "",
    normalizeString(input.message, 300) ?? ""
  ].join("|");
  return `autolog:${crypto.createHash("sha256").update(stableBase).digest("hex")}`;
}

export async function safeCreateCampaignLog(input: SafeCampaignLogInput): Promise<boolean> {
  const campaignId = normalizeString(input.campaignId, 191);
  const eventType = normalizeString(input.eventType, 191);
  const status = input.status ?? "success";
  if (!campaignId || !eventType) {
    console.warn("[campaignLog] write skipped", { reason: "missing_required_fields" });
    return false;
  }
  const idempotencyKey = resolveStableIdempotencyKey(input, campaignId, eventType, status);
  const data = {
    campaignId,
    recipientId: normalizeString(input.recipientId, 191),
    eventType,
    status,
    providerCode: normalizeString(input.providerCode, 191),
    message: normalizeString(input.message, 1000),
    idempotencyKey,
    metadata: (input.metadata ?? undefined) as Record<string, unknown> | undefined
  };

  try {
    await prisma.campaignLog.upsert({
      where: { idempotencyKey },
      update: {},
      create: data
    });
    return true;
  } catch (error) {
    if (isDuplicateIdempotencyError(error)) {
      const now = Date.now();
      if (now - lastDuplicateLogAt > 60_000) {
        lastDuplicateLogAt = now;
        console.debug("[campaignLog] duplicate skipped");
      }
      return false;
    }
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown_error";
    console.warn("[campaignLog] write skipped", { reason });
    return false;
  }
}
