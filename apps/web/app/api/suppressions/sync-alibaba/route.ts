import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  from: z.string(),
  to: z.string(),
  categories: z.array(z.enum(["invalid", "hard_bounce", "complaint", "blocked_rejected"])).min(1)
});

type Category = "invalid" | "hard_bounce" | "complaint" | "blocked_rejected" | "temporary";
type SyncMode = "real_api" | "mock" | "disabled";

function classify(providerCode: string | null, message: string | null): Category {
  const text = `${providerCode ?? ""} ${message ?? ""}`.toLowerCase();
  if (text.includes("temporary") || text.includes("timeout") || text.includes("defer")) return "temporary";
  if (text.includes("invalid")) return "invalid";
  if (text.includes("complaint")) return "complaint";
  if (text.includes("hard bounce") || text.includes("hard_bounce") || text.includes("bounce")) return "hard_bounce";
  if (text.includes("blocked") || text.includes("reject")) return "blocked_rejected";
  return "temporary";
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}

function resolveCredentialsPresent(): boolean {
  const keyId =
    process.env.ALIBABA_DM_ACCESS_KEY_ID ??
    process.env.ALIBABA_ACCESS_KEY_ID ??
    process.env.ALIYUN_ACCESS_KEY_ID;
  const keySecret =
    process.env.ALIBABA_DM_ACCESS_KEY_SECRET ??
    process.env.ALIBABA_ACCESS_KEY_SECRET ??
    process.env.ALIYUN_ACCESS_KEY_SECRET;
  return Boolean(keyId && keySecret);
}

function resolveMode(): SyncMode {
  const configured = (process.env.ALIBABA_SUPPRESSION_SYNC_MODE ?? "").trim().toLowerCase();
  if (configured === "disabled") return "disabled";
  if (configured === "real_api") return "real_api";
  return "mock";
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

  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ ok: false, error: "Invalid date range" }, { status: 400 });
  }

  const mode = resolveMode();
  const credentialsPresent = resolveCredentialsPresent();
  const errors: string[] = [];
  let apiRequestMade = false;
  let totalReportsReturned = 0;

  if (mode === "disabled") {
    await writeAuditLog(session.userId, "suppression.sync_alibaba", "suppression", {
      mode,
      credentialsPresent,
      dateRange: { from: from.toISOString(), to: to.toISOString() }
    });
    return NextResponse.json({
      ok: true,
      mode,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      credentialsPresent,
      apiRequestMade,
      totalReportsReturned,
      scanned: 0,
      matched: 0,
      added: 0,
      alreadySuppressed: 0,
      ignoredTemporary: 0,
      ignoredByCategory: 0,
      errors
    });
  }

  if (mode === "real_api") {
    if (!credentialsPresent) {
      errors.push("Alibaba credentials are not configured.");
    } else {
      errors.push("Alibaba sync is not connected to the real API yet.");
    }
    await writeAuditLog(session.userId, "suppression.sync_alibaba", "suppression", {
      mode,
      credentialsPresent,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      errors
    });
    return NextResponse.json({
      ok: true,
      mode,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      credentialsPresent,
      apiRequestMade,
      totalReportsReturned,
      scanned: 0,
      matched: 0,
      added: 0,
      alreadySuppressed: 0,
      ignoredTemporary: 0,
      ignoredByCategory: 0,
      errors
    });
  }

  const logs = await prisma.campaignLog.findMany({
    where: {
      status: "failed",
      createdAt: { gte: from, lte: to },
      recipientId: { not: null }
    },
    include: {
      recipient: {
        select: { email: true, emailNormalized: true }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 10000
  });
  totalReportsReturned = logs.length;

  const selected = new Set(parsed.data.categories);
  let scanned = 0;
  let ignoredTemporary = 0;
  let ignoredByCategory = 0;
  const candidateMap = new Map<string, { email: string; emailNormalized: string; reason: string }>();

  for (const log of logs) {
    if (!log.recipient?.emailNormalized) continue;
    scanned += 1;
    const category = classify(log.providerCode, log.message);
    if (category === "temporary") {
      ignoredTemporary += 1;
      continue;
    }
    if (!selected.has(category)) {
      ignoredByCategory += 1;
      continue;
    }
    candidateMap.set(log.recipient.emailNormalized, {
      email: log.recipient.email,
      emailNormalized: log.recipient.emailNormalized,
      reason: `alibaba_${category}`
    });
  }

  const candidates = [...candidateMap.values()];
  const existing = new Set<string>();
  for (const candidateChunk of chunk(candidates, 1000)) {
    const rows = await prisma.suppressionEntry.findMany({
      where: {
        emailNormalized: { in: candidateChunk.map((item) => item.emailNormalized) },
        scope: "global"
      },
      select: { emailNormalized: true }
    });
    for (const row of rows) existing.add(row.emailNormalized);
  }

  const addable = candidates.filter((item) => !existing.has(item.emailNormalized));
  let added = 0;
  for (const candidateChunk of chunk(addable, 1000)) {
    const created = await prisma.suppressionEntry.createMany({
      data: candidateChunk.map((item) => ({
        email: item.email,
        emailNormalized: item.emailNormalized,
        reason: item.reason,
        source: "alibaba_sync",
        scope: "global"
      })),
      skipDuplicates: true
    });
    added += created.count;
  }

  const summary = {
    mode,
    dateRange: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    credentialsPresent,
    apiRequestMade,
    totalReportsReturned,
    scanned,
    selectedCategories: parsed.data.categories,
    matched: candidates.length,
    added,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    ignoredByCategory
  };
  await writeAuditLog(session.userId, "suppression.sync_alibaba", "suppression", summary);
  return NextResponse.json({
    ok: true,
    mode,
    dateRange: summary.dateRange,
    credentialsPresent,
    apiRequestMade,
    totalReportsReturned,
    scanned,
    matched: candidates.length,
    added,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    ignoredByCategory,
    errors
  });
}
