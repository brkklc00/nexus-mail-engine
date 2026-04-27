import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { encryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  action: z.enum(["reset_throttle", "disable", "archive"]).optional(),
  name: z.string().min(2).optional(),
  host: z.string().min(2).optional(),
  port: z.number().int().positive().optional(),
  encryption: z.enum(["none", "tls", "ssl", "starttls"]).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  fromEmail: z.string().email().optional(),
  fromName: z.string().optional().nullable(),
  replyTo: z.string().email().optional().nullable(),
  providerLabel: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  targetRatePerSecond: z.number().positive().optional(),
  maxRatePerSecond: z.number().positive().optional().nullable(),
  dailyCap: z.number().int().positive().optional().nullable(),
  hourlyCap: z.number().int().positive().optional().nullable(),
  minuteCap: z.number().int().positive().optional().nullable(),
  warmupEnabled: z.boolean().optional(),
  warmupStartRps: z.number().positive().optional(),
  warmupIncrementStep: z.number().positive().optional(),
  warmupMaxRps: z.number().positive().optional().nullable(),
  tags: z.array(z.string()).optional(),
  groupLabel: z.string().optional().nullable(),
  healthStatus: z.enum(["healthy", "error", "disabled"]).optional(),
  connectionTimeout: z.number().int().positive().optional().nullable(),
  socketTimeout: z.number().int().positive().optional().nullable()
});

function isAlibabaProvider(providerLabel?: string | null, host?: string | null): boolean {
  const provider = (providerLabel ?? "").toLowerCase();
  const smtpHost = (host ?? "").toLowerCase();
  return provider.includes("alibaba") || provider.includes("aliyun") || smtpHost.includes("smtpdm");
}

function normalizePatchInput(data: z.infer<typeof schema>) {
  const next = { ...data } as Record<string, unknown>;
  const host = typeof data.host === "string" ? data.host : null;
  const providerLabel = typeof data.providerLabel === "string" ? data.providerLabel : null;
  const alibaba = isAlibabaProvider(providerLabel, host);
  const encryption = typeof data.encryption === "string" ? data.encryption : null;
  if (encryption) {
    if (encryption === "ssl") {
      next.encryption = "ssl";
      next.port = 465;
    } else if (encryption === "tls" || encryption === "starttls") {
      next.encryption = "tls";
      next.port = 587;
    } else {
      next.encryption = "none";
    }
  }
  if (alibaba) {
    next.encryption = "ssl";
    next.port = 465;
  }
  return next;
}

function isUnknownSmtpFieldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid `prisma.smtpAccount") && message.includes("Unknown argument");
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const data: Record<string, unknown> = normalizePatchInput(parsed.data);
  if (parsed.data.action === "reset_throttle") {
    data.isThrottled = false;
    data.throttleReason = null;
    data.cooldownUntil = null;
    data.healthStatus = "healthy";
    delete data.action;
  }
  if (parsed.data.action === "disable") {
    data.isActive = false;
    data.healthStatus = "disabled";
    delete data.action;
  }
  if (parsed.data.action === "archive") {
    data.isActive = false;
    data.isSoftDeleted = true;
    data.healthStatus = "disabled";
    delete data.action;
  }
  if (parsed.data.password) {
    data.passwordEncrypted = encryptSmtpSecret(parsed.data.password);
    delete data.password;
  }

  let account;
  try {
    account = await prisma.smtpAccount.update({
      where: { id },
      data
    });
  } catch (error) {
    if (isUnknownSmtpFieldError(error)) {
      const legacyKeys = new Set([
        "name",
        "host",
        "port",
        "encryption",
        "username",
        "passwordEncrypted",
        "fromEmail",
        "fromName",
        "replyTo",
        "providerLabel",
        "isActive",
        "targetRatePerSecond",
        "maxRatePerSecond",
        "dailyCap",
        "hourlyCap",
        "isThrottled",
        "throttleReason",
        "connectionTimeout",
        "socketTimeout",
        "isSoftDeleted"
      ]);
      const legacyData = Object.fromEntries(Object.entries(data).filter(([key]) => legacyKeys.has(key)));
      try {
        account = await prisma.smtpAccount.update({
          where: { id },
          data: legacyData
        });
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error("[api/smtp/[id] PATCH] fallback failed", { id, error: fallbackMessage });
        return NextResponse.json({ ok: false, error: "SMTP account not found" }, { status: 404 });
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[api/smtp/[id] PATCH] failed", { id, error: message });
      return NextResponse.json({ ok: false, error: "SMTP update failed", reason: message }, { status: 400 });
    }
  }
  await writeAuditLog(session.userId, "smtp.update", "smtp_account", { smtpAccountId: id });
  return NextResponse.json({ ok: true, account });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await prisma.smtpAccount.delete({ where: { id } });
    await writeAuditLog(session.userId, "smtp.hard_delete", "smtp_account", { smtpAccountId: id });
    return NextResponse.json({ ok: true, actionTaken: "hard_deleted" });
  } catch (error: any) {
    const code = error?.code ?? error?.meta?.code;
    if (code === "P2003") {
      try {
        await prisma.smtpAccount.update({
          where: { id },
          data: { isSoftDeleted: true, isActive: false, healthStatus: "disabled" }
        });
      } catch (fallbackError) {
        if (!isUnknownSmtpFieldError(fallbackError)) throw fallbackError;
        await prisma.smtpAccount.update({
          where: { id },
          data: { isSoftDeleted: true, isActive: false }
        });
      }
      await writeAuditLog(session.userId, "smtp.archive_in_use", "smtp_account", { smtpAccountId: id });
      return NextResponse.json(
        {
          ok: false,
          code: "smtp_in_use",
          error: "SMTP is used in campaigns, archived instead of deleted.",
          actionTaken: "archived"
        },
        { status: 409 }
      );
    }
    if (code === "P2025") {
      return NextResponse.json({ ok: false, error: "SMTP account not found" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/smtp/[id] DELETE] failed", { id, code, error: message });
    return NextResponse.json({ ok: false, error: "SMTP delete failed", reason: message }, { status: 400 });
  }
}
