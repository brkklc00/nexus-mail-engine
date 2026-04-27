import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { encryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  action: z.enum(["reset_throttle"]).optional(),
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
  healthStatus: z.enum(["healthy", "error", "disabled"]).optional()
});

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

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.action === "reset_throttle") {
    data.isThrottled = false;
    data.throttleReason = null;
    data.cooldownUntil = null;
    data.healthStatus = "healthy";
    delete data.action;
  }
  if (parsed.data.password) {
    data.passwordEncrypted = encryptSmtpSecret(parsed.data.password);
    delete data.password;
  }

  const account = await prisma.smtpAccount.update({
    where: { id },
    data
  });
  await writeAuditLog(session.userId, "smtp.update", "smtp_account", { smtpAccountId: id });
  return NextResponse.json({ ok: true, account });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await prisma.smtpAccount.update({
    where: { id },
    data: { isSoftDeleted: true, isActive: false, healthStatus: "disabled" }
  });
  await writeAuditLog(session.userId, "smtp.soft_delete", "smtp_account", { smtpAccountId: id });
  return NextResponse.json({ ok: true });
}
