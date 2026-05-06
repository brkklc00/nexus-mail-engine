import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import crypto from "node:crypto";

const schema = z.object({
  from: z.string(),
  to: z.string(),
  categories: z.array(z.enum(["invalid", "hard_bounce", "complaint", "blocked_rejected"])).min(1),
  removeFromLists: z.boolean().optional().default(true)
});

type Category = "invalid" | "hard_bounce" | "complaint" | "blocked_rejected" | "temporary";
type SyncMode = "real_api" | "mock" | "disabled";
type AlibabaCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
};
type NormalizedDateRange = {
  rawFrom: string;
  rawTo: string;
  from: Date;
  to: Date;
  todayDayKey: string;
  yesterdayDayKey: string;
};

type AlibabaApiRange = {
  startTime: string;
  endTime: string;
};

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

function resolveCredentials(): AlibabaCredentials | null {
  const accessKeyId =
    process.env.ALIBABA_DM_ACCESS_KEY_ID ??
    process.env.ALIBABA_ACCESS_KEY_ID ??
    process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret =
    process.env.ALIBABA_DM_ACCESS_KEY_SECRET ??
    process.env.ALIBABA_ACCESS_KEY_SECRET ??
    process.env.ALIYUN_ACCESS_KEY_SECRET;
  const region =
    process.env.ALIBABA_DM_REGION ??
    process.env.ALIBABA_REGION ??
    process.env.ALIYUN_REGION;
  if (!accessKeyId || !accessKeySecret || !region) return null;
  return { accessKeyId, accessKeySecret, region };
}

function resolveMode(): SyncMode {
  const configured = (process.env.ALIBABA_SUPPRESSION_SYNC_MODE ?? "").trim().toLowerCase();
  if (configured === "disabled") return "disabled";
  if (configured === "real_api") return "real_api";
  return resolveCredentials() ? "real_api" : "mock";
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

function parseDateInput(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const valueOf = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    year: valueOf("year"),
    month: valueOf("month"),
    day: valueOf("day")
  };
}

function normalizeDateRange(rawFrom: string, rawTo: string): NormalizedDateRange | null {
  const parsedFrom = parseDateInput(rawFrom);
  const parsedTo = parseDateInput(rawTo);
  if (!parsedFrom || !parsedTo) return null;

  const to = parsedTo;
  const from = parsedFrom;
  if (from.getTime() > to.getTime()) return null;
  const todayDayKey = dayKey(new Date());
  const yesterdayDayKey = previousDayKey(todayDayKey);

  return {
    rawFrom,
    rawTo,
    from,
    to,
    todayDayKey,
    yesterdayDayKey
  };
}

function dayKey(date: Date): string {
  const parts = toDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function previousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const prev = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  prev.setUTCDate(prev.getUTCDate() - 1);
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const d = String(prev.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayKeyDaysAgo(fromDayKey: string, days: number): string {
  const [year, month, day] = fromDayKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  value.setUTCDate(value.getUTCDate() - Math.max(0, days));
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daySpanInclusive(startDayKey: string, endDayKey: string): number {
  const [sy, sm, sd] = startDayKey.split("-").map(Number);
  const [ey, em, ed] = endDayKey.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd, 0, 0, 0);
  const endMs = Date.UTC(ey, em - 1, ed, 0, 0, 0);
  if (endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function compareDayKey(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function resolveAlibabaApiRange(input: {
  from: Date;
  to: Date;
  todayDayKey: string;
  yesterdayDayKey: string;
}): { range: AlibabaApiRange; warnings: string[] } {
  const { from, to, todayDayKey, yesterdayDayKey } = input;
  const warnings: string[] = [];
  let startKey = dayKey(from);
  let endKey = dayKey(to);

  if (compareDayKey(endKey, todayDayKey) >= 0) {
    endKey = yesterdayDayKey;
    warnings.push("Alibaba DirectMail only supports completed days. Showing yesterday instead.");
  }
  if (compareDayKey(startKey, todayDayKey) >= 0) {
    startKey = endKey;
    if (!warnings.includes("Alibaba DirectMail only supports completed days. Showing yesterday instead.")) {
      warnings.push("Alibaba DirectMail only supports completed days. Showing yesterday instead.");
    }
  }
  if (compareDayKey(startKey, endKey) > 0) {
    startKey = endKey;
  }

  const minStartKey = dayKeyDaysAgo(todayDayKey, 30);
  if (compareDayKey(startKey, minStartKey) < 0) {
    startKey = minStartKey;
    warnings.push("Alibaba DirectMail supports max 30-day lookback. Start date was clamped.");
  }
  if (compareDayKey(endKey, minStartKey) < 0) {
    endKey = minStartKey;
    warnings.push("Alibaba DirectMail supports max 30-day lookback. End date was clamped.");
  }

  const span = daySpanInclusive(startKey, endKey);
  if (span > 30) {
    startKey = dayKeyDaysAgo(endKey, 29);
    warnings.push("Alibaba DirectMail supports max 30-day range. Date range was clamped.");
  }

  return {
    range: {
      startTime: startKey,
      endTime: endKey
    },
    warnings
  };
}

function buildSignedAlibabaUrl(
  credentials: AlibabaCredentials,
  action: string,
  fromAlibaba: string,
  toAlibaba: string,
  length: number,
  nextStart: number | null
): string {
  const endpoint = process.env.ALIBABA_DM_API_ENDPOINT ?? `https://dm.${credentials.region}.aliyuncs.com/`;
  const nonce = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const params = new URLSearchParams({
    Action: action,
    Format: "JSON",
    Version: "2015-11-23",
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: nonce,
    Timestamp: timestamp,
    RegionId: credentials.region,
    StartTime: fromAlibaba,
    EndTime: toAlibaba,
    Length: String(Math.max(1, Math.floor(length)))
  });
  if (typeof nextStart === "number" && Number.isFinite(nextStart) && nextStart >= 0) {
    params.set("NextStart", String(Math.floor(nextStart)));
  }
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const canonicalized = sorted.map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join("&");
  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonicalized)}`;
  const signature = crypto
    .createHmac("sha1", `${credentials.accessKeySecret}&`)
    .update(stringToSign)
    .digest("base64");
  const signed = new URL(endpoint);
  for (const [k, v] of sorted) signed.searchParams.set(k, v);
  signed.searchParams.set("Signature", signature);
  return signed.toString();
}

function extractAlibabaReports(payload: any): Array<{ email: string; providerCode: string | null; message: string | null }> {
  const candidates = [
    payload?.Data?.AddressList?.Address,
    payload?.Data?.AddressList,
    payload?.Data?.Items,
    payload?.Data?.items,
    payload?.Items,
    payload?.items,
    payload?.Address,
    payload?.InvalidAddress
  ];
  const rawList = candidates.find((item) => Array.isArray(item));
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((row: any) => ({
      email: String(
        row?.EmailAddress ??
          row?.email ??
          row?.Address ??
          row?.address ??
          row?.ToAddress ??
          ""
      ).trim(),
      providerCode: row?.Code ? String(row.Code) : row?.ReasonCode ? String(row.ReasonCode) : null,
      message: row?.Message ? String(row.Message) : row?.Reason ? String(row.Reason) : null
    }))
    .filter((row) => row.email.length > 0);
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

  const normalizedRange = normalizeDateRange(parsed.data.from, parsed.data.to);
  if (!normalizedRange) {
    return NextResponse.json({ ok: false, error: "Invalid date range" }, { status: 400 });
  }
  const { from, to } = normalizedRange;

  const mode = resolveMode();
  const credentials = resolveCredentials();
  const credentialsPresent = Boolean(credentials);
  const { range: alibabaApiRange, warnings: rangeWarnings } = resolveAlibabaApiRange({
    from,
    to,
    todayDayKey: normalizedRange.todayDayKey,
    yesterdayDayKey: normalizedRange.yesterdayDayKey
  });
  const errors: string[] = [];
  const warnings: string[] = [...rangeWarnings];
  let apiRequestMade = false;
  let totalReportsReturned = 0;
  let removedFromLists = 0;
  let listRemovalSkipped = 0;
  const finalParams: Array<{ startTime: string; endTime: string }> = [];

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
      warnings,
      credentialsPresent,
      apiRequestMade,
      finalParams,
      totalReportsReturned,
      scanned: 0,
      matched: 0,
      added: 0,
      removedFromLists,
      listRemovalSkipped,
      alreadySuppressed: 0,
      ignoredTemporary: 0,
      ignoredByCategory: 0,
      errors
    });
  }

  if (mode === "real_api") {
    if (!credentialsPresent || !credentials) {
      errors.push("Alibaba credentials are not configured.");
    }
  }

  let reportRows: Array<{ email: string; emailNormalized: string; providerCode: string | null; message: string | null }> = [];
  if (mode === "real_api" && credentialsPresent && credentials) {
    try {
      const action = process.env.ALIBABA_DM_SUPPRESSION_ACTION ?? "QueryInvalidAddress";
      const requestLength = Math.max(1, Number(process.env.ALIBABA_DM_SYNC_PAGE_SIZE ?? 100));
      let nextStart: number | null = null;
      finalParams.push({
        startTime: alibabaApiRange.startTime,
        endTime: alibabaApiRange.endTime
      });

      do {
        const signedUrl = buildSignedAlibabaUrl(
          credentials,
          action,
          alibabaApiRange.startTime,
          alibabaApiRange.endTime,
          requestLength,
          nextStart
        );
        apiRequestMade = true;
        const debugUrl = new URL(signedUrl);
        const debugQuery = {
          Action: debugUrl.searchParams.get("Action"),
          StartTime: debugUrl.searchParams.get("StartTime"),
          EndTime: debugUrl.searchParams.get("EndTime"),
          Length: debugUrl.searchParams.get("Length"),
          NextStart: debugUrl.searchParams.get("NextStart")
        };
        console.info("[alibaba.sync] QueryInvalidAddress params", debugQuery);

        const response = await fetch(signedUrl, { method: "GET", cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as any;
        const extracted = extractAlibabaReports(payload);
        totalReportsReturned += extracted.length;
        reportRows.push(
          ...extracted.map((item) => ({
            email: item.email,
            emailNormalized: item.email.toLowerCase(),
            providerCode: item.providerCode,
            message: item.message
          }))
        );
        if (!response.ok) {
          errors.push(payload?.Message ? String(payload.Message) : `Alibaba API request failed with status ${response.status}`);
        }
        const alibabaCode = payload?.Code ? String(payload.Code) : null;
        const alibabaMessage = payload?.Message ? String(payload.Message) : null;
        if (alibabaCode || alibabaMessage) {
          errors.push([alibabaCode, alibabaMessage].filter(Boolean).join(": "));
          if (
            /invaliddate\.malformed/i.test(alibabaCode ?? "") ||
            /invaliddate\.malformed/i.test(alibabaMessage ?? "") ||
            /specified date is invalid/i.test(alibabaMessage ?? "")
          ) {
            errors.push("Alibaba rejected StartTime/EndTime. Expected format is YYYY-MM-DD.");
          }
        }
        const payloadNextStart =
          typeof payload?.Data?.NextStart === "number"
            ? payload.Data.NextStart
            : typeof payload?.NextStart === "number"
              ? payload.NextStart
              : null;
        if (typeof payloadNextStart === "number" && Number.isFinite(payloadNextStart) && payloadNextStart >= 0) {
          nextStart = payloadNextStart;
        } else {
          nextStart = null;
        }
      } while (nextStart !== null);

      console.info("[suppression.sync_alibaba] request_diagnostics", {
        rawSelectedRange: { from: normalizedRange.rawFrom, to: normalizedRange.rawTo },
        finalParams,
        mode,
        credentialsPresent,
        apiRequestMade,
        totalReportsReturned
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Alibaba API request failed");
      console.error("[suppression.sync_alibaba] request_failed", {
        rawSelectedRange: { from: normalizedRange.rawFrom, to: normalizedRange.rawTo },
        finalParams,
        mode,
        credentialsPresent,
        apiRequestMade,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (mode !== "real_api" || reportRows.length === 0) {
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
    if (mode !== "real_api") {
      totalReportsReturned = logs.length;
    }
    if (mode === "mock") {
      errors.push("Running in mock mode because Alibaba credentials/region are missing.");
    }
    reportRows = logs
      .filter((log: any) => Boolean(log.recipient?.emailNormalized))
      .map((log: any) => ({
        email: log.recipient!.email,
        emailNormalized: log.recipient!.emailNormalized,
        providerCode: log.providerCode,
        message: log.message
      }));
  }

  const selected = new Set(parsed.data.categories);
  let scanned = 0;
  let ignoredTemporary = 0;
  let ignoredByCategory = 0;
  const candidateMap = new Map<string, { email: string; emailNormalized: string; reason: string }>();

  for (const log of reportRows) {
    if (!log.emailNormalized) continue;
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
    candidateMap.set(log.emailNormalized, {
      email: log.email,
      emailNormalized: log.emailNormalized,
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

  if (parsed.data.removeFromLists && candidates.length > 0) {
    let totalRecipientsMatched = 0;
    const emailChunks = chunk(
      candidates.map((item) => item.emailNormalized),
      2000
    );
    for (const emailChunk of emailChunks) {
      const matchedRecipients = await prisma.recipient.findMany({
        where: { emailNormalized: { in: emailChunk } },
        select: { id: true }
      });
      totalRecipientsMatched += matchedRecipients.length;
      if (matchedRecipients.length === 0) continue;
      const recipientIdChunks = chunk(
        matchedRecipients.map((item: any) => item.id),
        2000
      );
      for (const recipientIdChunk of recipientIdChunks) {
        const deleted = await prisma.recipientListMembership.deleteMany({
          where: { recipientId: { in: recipientIdChunk } }
        });
        removedFromLists += deleted.count;
      }
    }
    listRemovalSkipped = Math.max(0, candidates.length - totalRecipientsMatched);
  } else {
    listRemovalSkipped = candidates.length;
  }

  console.info("[suppression.sync_alibaba] list cleanup", {
    totalSuppressedFetched: totalReportsReturned,
    totalSuppressedMatched: candidates.length,
    removedFromLists,
    listRemovalSkipped,
    removeFromListsEnabled: parsed.data.removeFromLists
  });

  const summary = {
    mode,
    dateRange: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    normalizedApiRange: {
      startTime: finalParams[0]?.startTime ?? "",
      endTime: finalParams[0]?.endTime ?? ""
    },
    finalParams,
    warnings,
    credentialsPresent,
    apiRequestMade,
    totalReportsReturned,
    scanned,
    selectedCategories: parsed.data.categories,
    matched: candidates.length,
    added,
    removedFromLists,
    listRemovalSkipped,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    ignoredByCategory
  };
  await writeAuditLog(session.userId, "suppression.sync_alibaba", "suppression", summary);
  return NextResponse.json({
    ok: true,
    mode,
    dateRange: summary.dateRange,
    normalizedApiRange: summary.normalizedApiRange,
    finalParams: summary.finalParams,
    warnings: summary.warnings,
    credentialsPresent,
    apiRequestMade,
    totalReportsReturned,
    scanned,
    matched: candidates.length,
    added,
    removedFromLists,
    listRemovalSkipped,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    ignoredByCategory,
    errors
  });
}
