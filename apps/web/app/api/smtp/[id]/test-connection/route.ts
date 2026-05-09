import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { runSmtpTest, updateSmtpHealthSafe } from "@/server/smtp/tester";

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

  const result = await runSmtpTest({
    smtp: smtp as any,
    testType: "connection",
    timeoutSeconds: 30
  });
  if (result.ok) {
    const testedAt = new Date();
    await updateSmtpHealthSafe(id, {
      healthStatus: "healthy",
      lastError: null,
      lastTestAt: testedAt
    });
    await writeAuditLog(session.userId, "smtp.test_connection", "smtp_account", {
      smtpAccountId: id,
      ok: true,
      testType: "connection"
    });
    return NextResponse.json({
      ok: true,
      result: {
        connected: true,
        kind: "connected",
        message: "SMTP connection successful."
      }
    });
  }
  const testedAt = new Date();
  await updateSmtpHealthSafe(id, {
    healthStatus: "error",
    lastError: String(result.errorMessage ?? "unknown_error").slice(0, 500),
    lastTestAt: testedAt
  });
  await writeAuditLog(session.userId, "smtp.test_connection", "smtp_account", {
    smtpAccountId: id,
    ok: false,
    kind: result.errorCode ?? "unknown_error"
  });
  return NextResponse.json(
    {
      ok: false,
      error: result.errorMessage ?? "unknown_error",
      errorKind: result.errorCode ?? "unknown_error",
      recommendation:
        result.errorCode === "auth_failed"
          ? "Alibaba DirectMail için doğru SMTP kullanıcı adı/şifresi kullandığınızdan emin olun."
          : result.errorCode === "tls_error"
            ? "465 için SSL, 587 için STARTTLS/TLS ayarını kontrol edin."
            : undefined
    },
    { status: 400 }
  );
}
