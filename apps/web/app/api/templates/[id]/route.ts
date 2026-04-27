import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const templateStatusSchema = z.enum(["draft", "active", "archived", "disabled"]);

const updateSchema = z.object({
  title: z.string().min(2).optional(),
  subject: z.string().min(1).optional(),
  htmlBody: z.string().min(1).optional(),
  plainTextBody: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  status: templateStatusSchema.optional()
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const current = await prisma.mailTemplate.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ ok: false, error: "Template not found" }, { status: 404 });
  }

  const template = await prisma.mailTemplate.update({
    where: { id },
    data: {
      ...parsed.data,
      version: { increment: 1 }
    }
  });
  await writeAuditLog(session.userId, "template.update", "mail_template", { templateId: id });
  return NextResponse.json({ ok: true, template });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const usageCount = await prisma.campaign.count({ where: { templateId: id } });
  if (usageCount > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "template_in_use",
        error: "Template is used by campaigns. Archive it instead.",
        campaignCount: usageCount
      },
      { status: 409 }
    );
  }

  try {
    await prisma.mailTemplate.delete({ where: { id } });
    await writeAuditLog(session.userId, "template.delete", "mail_template", { templateId: id });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Template cannot be deleted." }, { status: 400 });
  }
}
