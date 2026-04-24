import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const createSchema = z.object({
  email: z.string().email(),
  reason: z.string().min(2),
  source: z.string().optional(),
  scope: z.enum(["global", "list"]).default("global"),
  listId: z.string().uuid().optional()
});

const bulkSchema = z.object({
  emails: z.array(z.string().email()).min(1),
  reason: z.string().min(2),
  source: z.string().optional(),
  scope: z.enum(["global", "list"]).default("global"),
  listId: z.string().uuid().optional()
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const payload = await req.json();

  if (Array.isArray(payload.emails)) {
    const parsedBulk = bulkSchema.safeParse(payload);
    if (!parsedBulk.success) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }
    let inserted = 0;
    for (const email of parsedBulk.data.emails) {
      const normalized = email.trim().toLowerCase();
      await prisma.suppressionEntry
        .upsert({
          where: { emailNormalized_scope: { emailNormalized: normalized, scope: parsedBulk.data.scope } },
          create: {
            email,
            emailNormalized: normalized,
            reason: parsedBulk.data.reason,
            source: parsedBulk.data.source ?? "manual",
            scope: parsedBulk.data.scope,
            listId: parsedBulk.data.scope === "list" ? parsedBulk.data.listId ?? null : null
          },
          update: {
            reason: parsedBulk.data.reason,
            source: parsedBulk.data.source ?? "manual",
            listId: parsedBulk.data.scope === "list" ? parsedBulk.data.listId ?? null : null
          }
        })
        .then(() => {
          inserted += 1;
        });
    }
    await writeAuditLog(session.userId, "suppression.bulk_add", "suppression", { inserted });
    return NextResponse.json({ ok: true, inserted });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const normalized = parsed.data.email.trim().toLowerCase();
  const entry = await prisma.suppressionEntry.upsert({
    where: { emailNormalized_scope: { emailNormalized: normalized, scope: parsed.data.scope } },
    create: {
      email: parsed.data.email,
      emailNormalized: normalized,
      reason: parsed.data.reason,
      source: parsed.data.source ?? "manual",
      scope: parsed.data.scope,
      listId: parsed.data.scope === "list" ? parsed.data.listId ?? null : null
    },
    update: {
      reason: parsed.data.reason,
      source: parsed.data.source ?? "manual",
      listId: parsed.data.scope === "list" ? parsed.data.listId ?? null : null
    }
  });
  await writeAuditLog(session.userId, "suppression.add", "suppression", { suppressionId: entry.id });
  return NextResponse.json({ ok: true, entry });
}
