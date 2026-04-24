import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const createSchema = z.object({
  title: z.string().min(2),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
  plainTextBody: z.string().optional()
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const template = await prisma.mailTemplate.create({
    data: {
      title: parsed.data.title,
      subject: parsed.data.subject,
      htmlBody: parsed.data.htmlBody,
      plainTextBody: parsed.data.plainTextBody ?? null,
      status: "draft"
    }
  });

  await writeAuditLog(session.userId, "template.create", "mail_template", { templateId: template.id });
  return NextResponse.json({ ok: true, template });
}
