import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { encryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  name: z.string().min(2),
  host: z.string().min(2),
  port: z.number().int().positive(),
  encryption: z.enum(["none", "tls", "ssl"]),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  replyTo: z.string().email().optional().nullable(),
  providerLabel: z.string().optional().nullable(),
  targetRatePerSecond: z.number().positive().optional()
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const account = await prisma.smtpAccount.create({
    data: {
      name: parsed.data.name,
      host: parsed.data.host,
      port: parsed.data.port,
      encryption: parsed.data.encryption,
      username: parsed.data.username,
      passwordEncrypted: encryptSmtpSecret(parsed.data.password),
      fromEmail: parsed.data.fromEmail,
      fromName: parsed.data.fromName ?? null,
      replyTo: parsed.data.replyTo ?? null,
      providerLabel: parsed.data.providerLabel ?? null,
      targetRatePerSecond: parsed.data.targetRatePerSecond ?? 1
    }
  });
  await writeAuditLog(session.userId, "smtp.create", "smtp_account", { smtpAccountId: account.id });
  return NextResponse.json({ ok: true, account });
}
