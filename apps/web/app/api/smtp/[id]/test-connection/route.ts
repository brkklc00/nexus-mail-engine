import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { prisma } from "@nexus/db";
import { decryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

function isAlibabaProvider(providerLabel?: string | null, host?: string | null): boolean {
  const provider = (providerLabel ?? "").toLowerCase();
  const smtpHost = (host ?? "").toLowerCase();
  return provider.includes("alibaba") || provider.includes("aliyun") || smtpHost.includes("smtpdm");
}

function resolveTransportConfig(smtp: {
  host: string;
  port: number;
  encryption: string;
  username: string;
  passwordEncrypted: string;
  providerLabel: string | null;
  connectionTimeout: number | null;
  socketTimeout: number | null;
}) {
  const alibaba = isAlibabaProvider(smtp.providerLabel, smtp.host);
  const normalizedPort =
    smtp.encryption === "ssl" ? 465 : smtp.encryption === "tls" || smtp.encryption === "starttls" ? 587 : smtp.port;
  const port = alibaba ? 465 : normalizedPort;
  const secure = port === 465 ? true : smtp.encryption === "ssl";
  const requireTLS = port === 587 ? true : smtp.encryption === "tls" || smtp.encryption === "starttls";
  return {
    alibaba,
    config: {
      host: smtp.host,
      port,
      secure,
      requireTLS: secure ? false : requireTLS,
      connectionTimeout: alibaba ? 30000 : smtp.connectionTimeout ?? 12000,
      greetingTimeout: alibaba ? 30000 : 12000,
      socketTimeout: alibaba ? 60000 : smtp.socketTimeout ?? 15000,
      tls: {
        servername: smtp.host,
        rejectUnauthorized: true
      },
      auth: {
        user: smtp.username,
        pass: decryptSmtpSecret(smtp.passwordEncrypted)
      }
    }
  };
}

function mapTestError(error: unknown): { kind: string; message: string; recommendation?: string } {
  if (!(error instanceof Error)) {
    return { kind: "unknown", message: "Connection test failed" };
  }
  const message = error.message ?? "Connection test failed";
  const code = String((error as Error & { code?: string }).code ?? "");
  if (code === "EAUTH" || /auth/i.test(message)) {
    return {
      kind: "auth_failed",
      message: "SMTP authentication failed.",
      recommendation: "Alibaba DirectMail SMTP username/password kullandığınızdan emin olun."
    };
  }
  if (/greeting|Greeting/i.test(message)) {
    return {
      kind: "greeting_timeout",
      message: "SMTP greeting timeout.",
      recommendation: "Port/security eşleşmesini kontrol edin (Alibaba için SSL/465)."
    };
  }
  if (/socket|Unexpected socket close|ECONNRESET/i.test(message)) {
    return {
      kind: "socket_closed",
      message: "SMTP socket closed unexpectedly.",
      recommendation: "Firewall ve TLS ayarlarını kontrol edin."
    };
  }
  if (code === "ENOTFOUND" || /ENOTFOUND|getaddrinfo/i.test(message)) {
    return {
      kind: "dns_host_error",
      message: "SMTP host DNS resolution failed.",
      recommendation: "Host adını doğrulayın."
    };
  }
  if (/TLS|SSL|certificate/i.test(message)) {
    return {
      kind: "tls_mismatch",
      message: "TLS/SSL mismatch detected.",
      recommendation: "465 için secure=true, 587 için requireTLS=true kullanın."
    };
  }
  if (code === "ETIMEDOUT" || /timed out|timeout/i.test(message)) {
    return {
      kind: "timeout",
      message: "SMTP connection timed out.",
      recommendation: "Network erişimi ve timeout değerlerini kontrol edin."
    };
  }
  return { kind: "unknown", message };
}

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

  const resolved = resolveTransportConfig(smtp as any);
  let transporter: nodemailer.Transporter | null = null;
  try {
    transporter = nodemailer.createTransport(resolved.config as any);
    await transporter.verify();
    transporter.close();
    await prisma.smtpAccount.update({
      where: { id },
      data: {
        healthStatus: "healthy",
        lastError: null,
        lastTestAt: new Date()
      }
    });
    await writeAuditLog(session.userId, "smtp.test_connection", "smtp_account", {
      smtpAccountId: id,
      ok: true,
      providerAware: resolved.alibaba,
      secure: resolved.config.secure,
      requireTLS: resolved.config.requireTLS
    });
    return NextResponse.json({
      ok: true,
      result: {
        connected: true,
        kind: "connected",
        message: "SMTP connection successful."
      }
    });
  } catch (error) {
    const mapped = mapTestError(error);
    await prisma.smtpAccount.update({
      where: { id },
      data: {
        healthStatus: "error",
        lastError: mapped.message.slice(0, 500),
        lastTestAt: new Date()
      }
    });
    await writeAuditLog(session.userId, "smtp.test_connection", "smtp_account", {
      smtpAccountId: id,
      ok: false,
      kind: mapped.kind
    });
    return NextResponse.json(
      {
        ok: false,
        error: mapped.message,
        errorKind: mapped.kind,
        recommendation:
          mapped.recommendation ??
          (resolved.alibaba
            ? "Alibaba DirectMail için host smtpdm-*.aliyuncs.com, port 465, SSL ve SMTP password kullanın."
            : undefined)
      },
      { status: 400 }
    );
  } finally {
    transporter?.close();
  }
}
