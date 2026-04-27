import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  text: z.string().min(1),
  reason: z.string().optional(),
  source: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;

function parseInput(text: string): { valid: string[]; processed: number; invalidInput: number } {
  const rows = text
    .replace(/[;,]+/g, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  let invalidInput = 0;
  for (const row of rows) {
    const matches = row.match(emailRegex) ?? [row];
    for (const raw of matches) {
      const normalized = raw.trim().toLowerCase();
      if (!z.string().email().safeParse(normalized).success) {
        invalidInput += 1;
        continue;
      }
      unique.add(normalized);
    }
  }
  return { valid: [...unique], processed: rows.length, invalidInput };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const input = parseInput(parsed.data.text);
  if (input.valid.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { processed: input.processed, removed: 0, notFound: 0, invalidInput: input.invalidInput }
    });
  }

  let removed = 0;
  for (const emailChunk of chunk(input.valid, 1000)) {
    const result = await prisma.suppressionEntry.deleteMany({
      where: {
        emailNormalized: { in: emailChunk },
        scope: "global",
        ...(parsed.data.reason ? { reason: { contains: parsed.data.reason, mode: "insensitive" } } : {}),
        ...(parsed.data.source ? { source: { contains: parsed.data.source, mode: "insensitive" } } : {}),
        ...((parsed.data.from || parsed.data.to)
          ? {
              createdAt: {
                ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
              }
            }
          : {})
      }
    });
    removed += result.count;
  }

  const summary = {
    processed: input.processed,
    removed,
    notFound: Math.max(0, input.valid.length - removed),
    invalidInput: input.invalidInput
  };
  await writeAuditLog(session.userId, "suppression.bulk_remove", "suppression", summary);
  return NextResponse.json({ ok: true, summary });
}
