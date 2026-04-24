import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const payloadSchema = z.object({
  mode: z.enum(["single", "bulk"]).default("single"),
  recipientId: z.string().uuid().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  csvText: z.string().optional()
});

const removeSchema = z.object({
  recipientId: z.string().uuid()
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseBulkLines(csvText: string): Array<{ email: string; firstName?: string; lastName?: string; name?: string }> {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const out: Array<{ email: string; firstName?: string; lastName?: string; name?: string }> = [];
  for (const line of lines) {
    const [emailRaw, firstNameRaw, lastNameRaw] = line.split(",").map((part) => part?.trim() ?? "");
    if (!emailRaw) continue;
    out.push({
      email: emailRaw,
      firstName: firstNameRaw || undefined,
      lastName: lastNameRaw || undefined,
      name: firstNameRaw || lastNameRaw ? `${firstNameRaw} ${lastNameRaw}`.trim() : undefined
    });
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;
  const parsed = payloadSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const list = await prisma.recipientList.findUnique({ where: { id: listId } });
  if (!list) {
    return NextResponse.json({ ok: false, error: "List not found" }, { status: 404 });
  }

  const existingCount = await prisma.recipientListMembership.count({ where: { listId } });

  if (parsed.data.mode === "single") {
    if (parsed.data.recipientId) {
      await prisma.recipientListMembership.upsert({
        where: { listId_recipientId: { listId, recipientId: parsed.data.recipientId } },
        create: { listId, recipientId: parsed.data.recipientId },
        update: {}
      });
      return NextResponse.json({ ok: true });
    }

    if (!parsed.data.email) {
      return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 });
    }

    const normalized = normalizeEmail(parsed.data.email);
    if (!z.string().email().safeParse(normalized).success) {
      return NextResponse.json({ ok: false, error: "Invalid email format" }, { status: 400 });
    }

    if (existingCount + 1 > list.maxSize) {
      return NextResponse.json({ ok: false, error: "List max size reached" }, { status: 400 });
    }

    const recipient = await prisma.recipient.upsert({
      where: { emailNormalized: normalized },
      create: {
        email: parsed.data.email,
        emailNormalized: normalized,
        name: parsed.data.name ?? null,
        firstName: parsed.data.firstName ?? null,
        lastName: parsed.data.lastName ?? null,
        tags: [],
        status: "active"
      },
      update: {
        email: parsed.data.email,
        name: parsed.data.name ?? undefined,
        firstName: parsed.data.firstName ?? undefined,
        lastName: parsed.data.lastName ?? undefined
      }
    });

    await prisma.recipientListMembership.upsert({
      where: { listId_recipientId: { listId, recipientId: recipient.id } },
      create: { listId, recipientId: recipient.id },
      update: {}
    });

    await writeAuditLog(session.userId, "list.add_recipient", "recipient_list", { listId, recipientId: recipient.id });
    return NextResponse.json({ ok: true, recipient });
  }

  const csvText = parsed.data.csvText ?? "";
  if (!csvText.trim()) {
    return NextResponse.json({ ok: false, error: "csvText is required for bulk mode" }, { status: 400 });
  }

  const rows = parseBulkLines(csvText);
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;
  let insertedCount = 0;

  for (const row of rows) {
    const normalized = normalizeEmail(row.email);
    if (!z.string().email().safeParse(normalized).success) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(normalized)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(normalized);
  }

  if (existingCount + seen.size > list.maxSize) {
    return NextResponse.json({ ok: false, error: "List max size exceeded by import batch" }, { status: 400 });
  }

  for (const normalized of seen) {
    const row = rows.find((item) => normalizeEmail(item.email) === normalized);
    if (!row) continue;
    const recipient = await prisma.recipient.upsert({
      where: { emailNormalized: normalized },
      create: {
        email: row.email,
        emailNormalized: normalized,
        name: row.name ?? null,
        firstName: row.firstName ?? null,
        lastName: row.lastName ?? null,
        tags: [],
        status: "active"
      },
      update: {
        email: row.email,
        firstName: row.firstName ?? undefined,
        lastName: row.lastName ?? undefined,
        name: row.name ?? undefined
      }
    });
    await prisma.recipientListMembership.upsert({
      where: { listId_recipientId: { listId, recipientId: recipient.id } },
      create: { listId, recipientId: recipient.id },
      update: {}
    });
    insertedCount += 1;
  }

  await writeAuditLog(session.userId, "list.import_recipients", "recipient_list", {
    listId,
    insertedCount,
    invalidCount,
    duplicateCount
  });

  return NextResponse.json({ ok: true, insertedCount, invalidCount, duplicateCount });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;
  const parsed = removeSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  await prisma.recipientListMembership.delete({
    where: {
      listId_recipientId: { listId, recipientId: parsed.data.recipientId }
    }
  });
  await writeAuditLog(session.userId, "list.remove_recipient", "recipient_list", {
    listId,
    recipientId: parsed.data.recipientId
  });
  return NextResponse.json({ ok: true });
}
