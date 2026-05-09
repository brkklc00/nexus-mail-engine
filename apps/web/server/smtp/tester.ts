import nodemailer from "nodemailer";
import { prisma } from "@nexus/db";
import { decryptSmtpSecret } from "@nexus/security";

export type SmtpTestType = "connection" | "send_test_email" | "both";
export type SmtpErrorCode =
  | "auth_failed"
  | "timeout"
  | "connection_refused"
  | "tls_error"
  | "provider_rate_limit"
  | "unknown_error"
  | "missing_configuration";

type SmtpForTest = {
  id: string;
  host: string;
  port: number;
  encryption: string;
  username: string;
  passwordEncrypted: string;
  fromEmail: string;
  fromName: string | null;
  providerLabel: string | null;
  connectionTimeout: number | null;
  socketTimeout: number | null;
};

export function isAlibabaProvider(providerLabel?: string | null, host?: string | null): boolean {
  const provider = (providerLabel ?? "").toLowerCase();
  const smtpHost = (host ?? "").toLowerCase();
  return provider.includes("alibaba") || provider.includes("aliyun") || smtpHost.includes("smtpdm");
}

export function resolveTransportConfig(smtp: SmtpForTest, timeoutSeconds: number) {
  const alibaba = isAlibabaProvider(smtp.providerLabel, smtp.host);
  const normalizedPort =
    smtp.encryption === "ssl" ? 465 : smtp.encryption === "tls" || smtp.encryption === "starttls" ? 587 : smtp.port;
  const port = alibaba ? 465 : normalizedPort;
  const secure = port === 465 ? true : smtp.encryption === "ssl";
  const requireTLS = port === 587 ? true : smtp.encryption === "tls" || smtp.encryption === "starttls";
  const timeoutMs = Math.max(5_000, timeoutSeconds * 1000);
  return {
    config: {
      host: smtp.host,
      port,
      secure,
      requireTLS: secure ? false : requireTLS,
      connectionTimeout: smtp.connectionTimeout ?? timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: smtp.socketTimeout ?? timeoutMs,
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

export function validateSmtpForTest(smtp: Partial<SmtpForTest>): { ok: boolean; error?: string } {
  if (!smtp.host || !smtp.port || !smtp.encryption || !smtp.username || !smtp.passwordEncrypted || !smtp.fromEmail) {
    return { ok: false, error: "missing_configuration" };
  }
  return { ok: true };
}

export function mapTestError(error: unknown): { code: SmtpErrorCode; message: string } {
  if (!(error instanceof Error)) {
    return { code: "unknown_error", message: "unknown_error" };
  }
  const message = error.message ?? "unknown_error";
  const code = String((error as Error & { code?: string }).code ?? "");
  const lower = message.toLowerCase();
  if (code === "EAUTH" || /auth/i.test(lower)) return { code: "auth_failed", message: "auth_failed" };
  if (code === "ETIMEDOUT" || /timed out|timeout/i.test(lower)) return { code: "timeout", message: "timeout" };
  if (code === "ECONNREFUSED" || /refused|econnrefused/i.test(lower)) {
    return { code: "connection_refused", message: "connection_refused" };
  }
  if (/tls|ssl|certificate/i.test(lower)) return { code: "tls_error", message: "tls_error" };
  if (/rate|throttle|too many/i.test(lower)) return { code: "provider_rate_limit", message: "provider_rate_limit" };
  return { code: "unknown_error", message: "unknown_error" };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function runSmtpTest(input: {
  smtp: SmtpForTest;
  testType: SmtpTestType;
  timeoutSeconds: number;
  testRecipient?: string;
}) {
  const startedAt = Date.now();
  const validation = validateSmtpForTest(input.smtp);
  if (!validation.ok) {
    return {
      ok: false as const,
      latencyMs: Date.now() - startedAt,
      errorCode: "missing_configuration" as SmtpErrorCode,
      errorMessage: "missing_configuration"
    };
  }

  const transporter = nodemailer.createTransport(resolveTransportConfig(input.smtp, input.timeoutSeconds).config as any);
  try {
    await withTimeout(transporter.verify(), Math.max(5_000, input.timeoutSeconds * 1000));
    if ((input.testType === "send_test_email" || input.testType === "both") && input.testRecipient) {
      await withTimeout(
        transporter.sendMail({
          from: `"${input.smtp.fromName ?? "Nexus"}" <${input.smtp.fromEmail}>`,
          to: input.testRecipient,
          subject: "Nexus SMTP Test",
          text: "Bu bir SMTP test e-postasıdır.",
          html: "<p>Bu bir SMTP test e-postasıdır.</p>"
        }),
        Math.max(5_000, input.timeoutSeconds * 1000)
      );
    }
    return {
      ok: true as const,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    const mapped = mapTestError(error);
    return {
      ok: false as const,
      latencyMs: Date.now() - startedAt,
      errorCode: mapped.code,
      errorMessage: mapped.message
    };
  } finally {
    transporter.close();
  }
}

function isUnknownSmtpFieldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid `prisma.smtpAccount.update() invocation") && message.includes("Unknown argument");
}

export async function updateSmtpHealthSafe(
  id: string,
  data: {
    healthStatus?: string;
    lastError?: string | null;
    lastTestAt?: Date;
    isThrottled?: boolean;
    throttleReason?: string | null;
    cooldownUntil?: Date | null;
  }
) {
  try {
    await prisma.smtpAccount.update({
      where: { id },
      data
    });
    return;
  } catch (error) {
    if (!isUnknownSmtpFieldError(error)) {
      return;
    }
  }
  try {
    const {
      healthStatus: _ignoredHealth,
      isThrottled: _ignoredThrottle,
      throttleReason: _ignoredReason,
      cooldownUntil: _ignoredCooldown,
      ...fallback
    } = data;
    if (Object.keys(fallback).length > 0) {
      await prisma.smtpAccount.update({ where: { id }, data: fallback });
    }
  } catch {
    // noop
  }
}
