import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { prisma } from "@nexus/db";
import { decryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const smtp = await prisma.smtpAccount.findUnique({ where: { id } });
  if (!smtp || smtp.isSoftDeleted) {
    return NextResponse.json({ ok: false, error: "SMTP not found" }, { status: 404 });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.encryption === "ssl",
      auth: {
        user: smtp.username,
        pass: decryptSmtpSecret(smtp.passwordEncrypted)
      }
    });
    await transporter.verify();
    await prisma.smtpAccount.update({
      where: { id },
      data: {
        healthStatus: "healthy",
        lastError: null,
        lastTestAt: new Date()
      }
    });
    await writeAuditLog(session.userId, "smtp.test_connection", "smtp_account", { smtpAccountId: id, ok: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await prisma.smtpAccount.update({
      where: { id },
      data: {
        healthStatus: "error",
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Connection test failed",
        lastTestAt: new Date()
      }
    });
    await writeAuditLog(session.userId, "smtp.test_connection", "smtp_account", { smtpAccountId: id, ok: false });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Connection test failed" },
      { status: 400 }
    );
  }
}
