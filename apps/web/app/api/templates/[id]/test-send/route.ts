import { NextResponse } from "next/server";
import { z } from "zod";
import nodemailer from "nodemailer";
import { prisma } from "@nexus/db";
import { MailTemplateRenderer } from "@nexus/mailer";
import { decryptSmtpSecret } from "@nexus/security";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  smtpAccountId: z.string().uuid(),
  toEmail: z.string().email(),
  variables: z.record(z.string(), z.string()).optional()
});

function mapSmtpError(error: unknown): { message: string; kind: string } {
  const fallback = { message: "SMTP test send failed.", kind: "smtp_unknown_error" };
  if (!(error instanceof Error)) return fallback;
  const message = error.message ?? "";
  const code = (error as Error & { code?: string }).code ?? "";

  if (code === "ETIMEDOUT" || /timed out|ETIMEDOUT|CONN/i.test(message)) {
    return { message: "SMTP connection timeout. Host/port/encryption ayarlarini kontrol edin.", kind: "smtp_timeout" };
  }
  if (/greeting/i.test(message)) {
    return { message: "SMTP greeting never received. SSL/TLS port uyumunu kontrol edin.", kind: "smtp_greeting_failed" };
  }
  if (/Unexpected socket close|socket close/i.test(message)) {
    return { message: "SMTP socket unexpectedly closed. Encryption veya firewall ayari sorunlu olabilir.", kind: "smtp_socket_closed" };
  }
  if (code === "EAUTH" || /auth/i.test(message)) {
    return { message: "SMTP authentication failed. Kullanici bilgisi veya sifre gecersiz.", kind: "smtp_auth_failed" };
  }
  return { message: message || fallback.message, kind: "smtp_send_failed" };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const [template, smtp] = await Promise.all([
    prisma.mailTemplate.findUnique({ where: { id } }),
    prisma.smtpAccount.findUnique({ where: { id: parsed.data.smtpAccountId } })
  ]);

  if (!template || !smtp || !smtp.isActive || smtp.isSoftDeleted) {
    return NextResponse.json({ ok: false, error: "Template or SMTP not available" }, { status: 404 });
  }

  const renderer = new MailTemplateRenderer();
  const rendered = renderer.render({
    htmlBody: template.htmlBody,
    plainTextBody: template.plainTextBody,
    variables: parsed.data.variables ?? {
      name: "Test Recipient",
      email: parsed.data.toEmail,
      first_name: "Test",
      last_name: "Recipient"
    }
  });

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.encryption === "ssl" || smtp.port === 465,
    requireTLS: smtp.encryption === "tls",
    connectionTimeout: smtp.connectionTimeout ?? 12_000,
    greetingTimeout: 12_000,
    socketTimeout: smtp.socketTimeout ?? 15_000,
    auth: {
      user: smtp.username,
      pass: decryptSmtpSecret(smtp.passwordEncrypted)
    }
  });

  try {
    const timeoutMs = 20_000;
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(Object.assign(new Error("SMTP verify timeout"), { code: "ETIMEDOUT" }));
        }, timeoutMs);
      })
    ]);

    await Promise.race([
      transporter.sendMail({
        from: `"${smtp.fromName ?? "Nexus"}" <${smtp.fromEmail}>`,
        to: parsed.data.toEmail,
        subject: `[TEST] ${template.subject}`,
        html: rendered.html,
        text: rendered.text
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(Object.assign(new Error("SMTP send timeout"), { code: "ETIMEDOUT" }));
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    const mapped = mapSmtpError(error);
    return NextResponse.json(
      {
        ok: false,
        error: mapped.message,
        errorKind: mapped.kind,
        hint:
          smtp.providerLabel?.toLowerCase().includes("alibaba") || smtp.host.toLowerCase().includes("aliyun")
            ? "Alibaba/Aliyun icin SSL + 465 kullanimi yaygin. Secure ayarini kontrol edin."
            : undefined
      },
      { status: 400 }
    );
  } finally {
    transporter.close();
  }

  await writeAuditLog(session.userId, "template.test_send", "mail_template", {
    templateId: id,
    smtpAccountId: smtp.id,
    toEmail: parsed.data.toEmail
  });

  return NextResponse.json({ ok: true });
}
