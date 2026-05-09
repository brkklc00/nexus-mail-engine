import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  removeFromLists: z.boolean().optional().default(true)
});

type FailureCategory = "invalid_address" | "hard_bounce" | "complaint" | "temporary" | "unknown";

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function classifyFailure(providerCode: string | null | undefined, message: string | null | undefined): FailureCategory {
  const text = `${providerCode ?? ""} ${message ?? ""}`.toLowerCase();

  if (
    text.includes("rate_limited_wait_timeout") ||
    text.includes("timeout") ||
    text.includes("greylist") ||
    text.includes("temporary fail") ||
    text.includes("throttled") ||
    text.includes("connection reset") ||
    text.includes("mailbox full")
  ) {
    return "temporary";
  }

  if (text.includes("complaint")) return "complaint";

  if (
    text.includes("invalid recipient") ||
    text.includes("mailbox not found") ||
    text.includes("user unknown") ||
    text.includes("domain not found") ||
    text.includes("invalid address")
  ) {
    return "invalid_address";
  }

  if (text.includes("hard bounce")) return "hard_bounce";

  return "unknown";
}

function parseRange(input: { from?: string; to?: string }) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const parsedFrom = input.from ? new Date(input.from) : defaultFrom;
  const parsedTo = input.to ? new Date(input.to) : now;
  return {
    from: Number.isNaN(parsedFrom.getTime()) ? defaultFrom : parsedFrom,
    to: Number.isNaN(parsedTo.getTime()) ? now : parsedTo
  };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const range = parseRange(parsed.data);
  const logs = await prisma.campaignLog.findMany({
    where: {
      status: "failed",
      recipientId: { not: null },
      createdAt: { gte: range.from, lte: range.to }
    },
    select: {
      providerCode: true,
      message: true,
      recipient: {
        select: {
          email: true,
          emailNormalized: true
        }
      }
    },
    take: 50000,
    orderBy: { createdAt: "desc" }
  });

  let scanned = 0;
  let ignoredTemporary = 0;
  let ignoredUnknown = 0;
  const candidates = new Map<string, { email: string; emailNormalized: string; reason: string }>();

  for (const row of logs) {
    if (!row.recipient?.emailNormalized) continue;
    scanned += 1;
    const category = classifyFailure(row.providerCode, row.message);
    if (category === "temporary") {
      ignoredTemporary += 1;
      continue;
    }
    if (category === "unknown") {
      ignoredUnknown += 1;
      continue;
    }
    candidates.set(row.recipient.emailNormalized, {
      email: row.recipient.email,
      emailNormalized: row.recipient.emailNormalized,
      reason: category
    });
  }

  const candidateRows = [...candidates.values()];
  const existing = new Set<string>();
  for (const emailChunk of chunk(candidateRows.map((item) => item.emailNormalized), 1000)) {
    const rows = await prisma.suppressionEntry.findMany({
      where: {
        scope: "global",
        emailNormalized: { in: emailChunk }
      },
      select: { emailNormalized: true }
    });
    for (const row of rows) existing.add(row.emailNormalized);
  }

  const addable = candidateRows.filter((item) => !existing.has(item.emailNormalized));
  let added = 0;
  for (const addableChunk of chunk(addable, 1000)) {
    const result = await prisma.suppressionEntry.createMany({
      data: addableChunk.map((item) => ({
        email: item.email,
        emailNormalized: item.emailNormalized,
        reason: item.reason,
        source: "campaign_failure_fallback",
        scope: "global"
      })),
      skipDuplicates: true
    });
    added += result.count;
  }

  const suppressedNowRows =
    addable.length > 0
      ? await prisma.suppressionEntry.findMany({
          where: {
            scope: "global",
            emailNormalized: { in: addable.map((item) => item.emailNormalized) }
          },
          select: { emailNormalized: true }
        })
      : [];
  const suppressedNowEmails = new Set(suppressedNowRows.map((row: { emailNormalized: string }) => row.emailNormalized));

  let removedFromLists = 0;
  if (parsed.data.removeFromLists && suppressedNowEmails.size > 0) {
    const recipientRows = await prisma.recipient.findMany({
      where: { emailNormalized: { in: [...suppressedNowEmails] } },
      select: { id: true }
    });
    for (const recipientChunk of chunk(recipientRows.map((item: { id: string }) => item.id), 2000)) {
      const deleted = await prisma.recipientListMembership.deleteMany({
        where: { recipientId: { in: recipientChunk } }
      });
      removedFromLists += deleted.count;
    }
  }

  const summary = {
    scanned,
    added,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    ignoredUnknown,
    removedFromLists,
    rangeFrom: range.from.toISOString(),
    rangeTo: range.to.toISOString()
  };

  await writeAuditLog(session.userId, "suppression.from_campaign_failures", "suppression", summary);

  return NextResponse.json({
    ok: true,
    scanned,
    added,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    removedFromLists
  });
}
