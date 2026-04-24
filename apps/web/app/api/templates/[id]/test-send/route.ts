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
    secure: smtp.encryption === "ssl",
    auth: {
      user: smtp.username,
      pass: decryptSmtpSecret(smtp.passwordEncrypted)
    }
  });

  await transporter.sendMail({
    from: `"${smtp.fromName ?? "Nexus"}" <${smtp.fromEmail}>`,
    to: parsed.data.toEmail,
    subject: `[TEST] ${template.subject}`,
    html: rendered.html,
    text: rendered.text
  });

  await writeAuditLog(session.userId, "template.test_send", "mail_template", {
    templateId: id,
    smtpAccountId: smtp.id,
    toEmail: parsed.data.toEmail
  });

  return NextResponse.json({ ok: true });
}
