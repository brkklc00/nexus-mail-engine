import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { resolveSmtpScope } from "@/app/api/smtp/_bulk-utils";

const schema = z.object({
  scope: z.enum(["all_active", "selected", "healthy", "error"]),
  smtpAccountIds: z.array(z.string()).optional(),
  includeAuthErrors: z.boolean().optional(),
  setHealthy: z.boolean().optional()
});

function looksLikeAuthFailure(message: string | null | undefined) {
  const text = String(message ?? "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("auth") ||
    text.includes("authentication") ||
    text.includes("535") ||
    text.includes("username") ||
    text.includes("password") ||
    text.includes("invalid credentials")
  );
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const includeAuthErrors = parsed.data.includeAuthErrors === true;
  const resolved = await resolveSmtpScope({
    scope: parsed.data.scope,
    smtpAccountIds: parsed.data.smtpAccountIds,
    onlyActive: true
  });

  if (resolved.ids.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, skipped: 0, authSkipped: 0 });
  }

  const rows = await prisma.smtpAccount.findMany({
    where: {
      id: { in: resolved.ids },
      isSoftDeleted: false
    },
    select: { id: true, lastError: true }
  });

  const authSkippedIds = includeAuthErrors
    ? []
    : rows.filter((row: { id: string; lastError: string | null }) => looksLikeAuthFailure(row.lastError)).map((row: { id: string; lastError: string | null }) => row.id);
  const targetIds = rows.filter((row: { id: string; lastError: string | null }) => !authSkippedIds.includes(row.id)).map((row: { id: string; lastError: string | null }) => row.id);

  if (targetIds.length === 0) {
    return NextResponse.json({
      ok: true,
      updated: 0,
      skipped: resolved.ids.length,
      authSkipped: authSkippedIds.length
    });
  }

  const updateData: any = {
    isThrottled: false,
    throttleReason: null,
    cooldownUntil: null,
    lastError: null
  };
  if (parsed.data.setHealthy) {
    updateData.healthStatus = "healthy";
  }

  const result = await prisma.smtpAccount.updateMany({
    where: {
      id: { in: targetIds },
      isSoftDeleted: false
    },
    data: updateData
  });

  await writeAuditLog(session.userId, "smtp.bulk_reset_throttle", "smtp_account", {
    scope: parsed.data.scope,
    selectedCount: parsed.data.smtpAccountIds?.length ?? 0,
    resolvedCount: resolved.ids.length,
    updated: result.count,
    includeAuthErrors,
    authSkipped: authSkippedIds.length,
    setHealthy: Boolean(parsed.data.setHealthy)
  });

  return NextResponse.json({
    ok: true,
    updated: result.count,
    skipped: Math.max(0, resolved.ids.length - result.count),
    authSkipped: authSkippedIds.length
  });
}

