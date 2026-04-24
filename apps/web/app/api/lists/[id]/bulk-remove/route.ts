import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  text: z.string().min(1),
  removeFromAllLists: z.boolean().default(false),
  addToSuppression: z.boolean().default(false),
  suppressionReason: z.string().default("manual_bulk_remove")
});

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;

function parseEmails(text: string): string[] {
  const matches = text.match(emailRegex) ?? [];
  return Array.from(new Set(matches.map((item) => item.trim().toLowerCase())));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const emails = parseEmails(parsed.data.text);
  if (emails.length === 0) {
    return NextResponse.json({
      ok: true,
      result: { totalProcessed: 0, removedMemberships: 0, recipientMatches: 0, suppressionAdded: 0 }
    });
  }

  let recipientMatches = 0;
  let removedMemberships = 0;
  let suppressionAdded = 0;

  for (const emailChunk of chunk(emails, 1000)) {
    const recipients = await prisma.recipient.findMany({
      where: { emailNormalized: { in: emailChunk } },
      select: { id: true, email: true, emailNormalized: true }
    });
    recipientMatches += recipients.length;
    if (recipients.length === 0) continue;
    const recipientIds = recipients.map((r: { id: string }) => r.id);

    const deleteResult = await prisma.recipientListMembership.deleteMany({
      where: parsed.data.removeFromAllLists
        ? { recipientId: { in: recipientIds } }
        : { listId, recipientId: { in: recipientIds } }
    });
    removedMemberships += deleteResult.count;

    if (parsed.data.addToSuppression) {
      for (const recipient of recipients) {
        await prisma.suppressionEntry.upsert({
          where: {
            emailNormalized_scope: {
              emailNormalized: recipient.emailNormalized,
              scope: "global"
            }
          },
          create: {
            email: recipient.email,
            emailNormalized: recipient.emailNormalized,
            scope: "global",
            reason: parsed.data.suppressionReason,
            source: "bulk_remove"
          },
          update: {
            reason: parsed.data.suppressionReason,
            source: "bulk_remove"
          }
        });
        suppressionAdded += 1;
      }
    }
  }

  const result = {
    totalProcessed: emails.length,
    recipientMatches,
    removedMemberships,
    suppressionAdded
  };
  await writeAuditLog(session.userId, "list.bulk_remove", "recipient_list", {
    listId,
    ...result,
    removeFromAllLists: parsed.data.removeFromAllLists,
    addToSuppression: parsed.data.addToSuppression
  });

  return NextResponse.json({ ok: true, result });
}
