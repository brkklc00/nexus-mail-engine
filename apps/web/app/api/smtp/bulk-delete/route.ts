import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1)
});

function isUnknownSmtpFieldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid `prisma.smtpAccount") && message.includes("Unknown argument");
}

/**
 * Soft-delete (archive) SMTP accounts. Never removes rows that participate in campaign FKs via hard delete.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const uniqueIds = [...new Set(parsed.data.ids)];
  let deleted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const id of uniqueIds) {
    try {
      const row = await prisma.smtpAccount.findFirst({
        where: { id, isSoftDeleted: false },
        select: { id: true, name: true }
      });
      if (!row) {
        skipped += 1;
        errors.push(`SMTP ${id.slice(0, 8)}…: not found or already archived`);
        continue;
      }

      try {
        await prisma.smtpAccount.update({
          where: { id },
          data: {
            isSoftDeleted: true,
            isActive: false,
            healthStatus: "disabled"
          }
        });
      } catch (error) {
        if (!isUnknownSmtpFieldError(error)) throw error;
        await prisma.smtpAccount.update({
          where: { id },
          data: {
            isSoftDeleted: true,
            isActive: false
          }
        });
      }
      deleted += 1;
    } catch (error) {
      skipped += 1;
      const msg = error instanceof Error ? error.message : "update failed";
      errors.push(`SMTP ${id.slice(0, 8)}…: ${msg}`);
    }
  }

  await writeAuditLog(session.userId, "smtp.bulk_soft_delete", "smtp_account", {
    deleted,
    skipped,
    idCount: uniqueIds.length
  });

  return NextResponse.json({
    ok: true,
    deleted,
    skipped,
    errors
  });
}
