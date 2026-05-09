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
  startDay: string;
  endDay: string;
  warnings: string[];
};

type AlibabaApiRange = {
  startTime: string;
  endTime: string;
};

function toNumericValue(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function classify(providerCode: string | null, message: string | null): Category {
  const text = `${providerCode ?? ""} ${message ?? ""}`.toLowerCase();
  if (
    text.includes("temporary") ||
    text.includes("timeout") ||
    text.includes("defer") ||
    text.includes("greylist") ||
    text.includes("mailbox full") ||
    text.includes("rate limit") ||
    text.includes("connection temporary")
  ) {
    return "temporary";
  }
  if (
    text.includes("invalid") ||
    text.includes("mailbox not exists") ||
    text.includes("invalid domain") ||
    text.includes("no dns") ||
    text.includes("donotmail") ||
    text.includes("abnormal address")
  ) {
    return "invalid";
  }
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
  const valueOf = (num: number) => String(num).padStart(2, "0");
  return {
    year: String(date.getUTCFullYear()),
    month: valueOf(date.getUTCMonth() + 1),
    day: valueOf(date.getUTCDate())
  };
}

function normalizeDateRange(rawFrom: string, rawTo: string): NormalizedDateRange | null {
  const parsedFrom = parseDateInput(rawFrom);
  const parsedTo = parseDateInput(rawTo);
  if (!parsedFrom || !parsedTo) return null;
  const warnings: string[] = [];
  let startDay = dayKey(parsedFrom);
  let endDay = dayKey(parsedTo);
  if (compareDayKey(startDay, endDay) > 0) return null;

  const todayDay = dayKey(new Date());
  const yesterdayDay = previousDayKey(todayDay);
  const minStartDay = dayKeyDaysAgo(yesterdayDay, 29);

  if (compareDayKey(endDay, todayDay) >= 0) {
    endDay = yesterdayDay;
    warnings.push("Alibaba DirectMail only supports completed days. Showing yesterday instead.");
  }
  if (compareDayKey(startDay, todayDay) >= 0) {
    startDay = endDay;
    warnings.push("Alibaba DirectMail only supports completed days. Showing yesterday instead.");
  }
  if (compareDayKey(startDay, endDay) > 0) {
    startDay = endDay;
  }
  if (compareDayKey(startDay, minStartDay) < 0) {
    startDay = minStartDay;
    warnings.push("Alibaba DirectMail en fazla son 30 gunu destekler. Baslangic tarihi sinirlandi.");
  }
  if (compareDayKey(endDay, minStartDay) < 0) {
    endDay = minStartDay;
    warnings.push("Alibaba DirectMail en fazla son 30 gunu destekler. Bitis tarihi sinirlandi.");
  }
  if (daySpanInclusive(startDay, endDay) > 30) {
    startDay = dayKeyDaysAgo(endDay, 29);
    warnings.push("Alibaba DirectMail tarih araligi 30 gunden fazla olamaz. Aralik sinirlandi.");
  }

  return { rawFrom, rawTo, startDay, endDay, warnings };
}

function dayKey(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const parts = toDateParts(utcDate);
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

function extractRawAlibabaRecords(payload: any) {
  const root = payload?.Body && typeof payload.Body === "object" ? payload.Body : payload;
  const data = root?.Data ?? root?.data ?? root;
  const responseKeys = Object.keys(root ?? {});
  const candidates = [
    data?.InvalidAddressList?.Address,
    data?.InvalidAddressList,
    data?.invalidAddressList,
    root?.InvalidAddressList?.Address,
    root?.InvalidAddressList,
    root?.invalidAddressList,
    data?.AddressList?.Address,
    data?.AddressList,
    data?.items,
    data?.Items,
    root?.items,
    root?.Items
  ];
  let records: any[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      records = candidate;
      break;
    }
    if (candidate && typeof candidate === "object") {
      const nestedArray = Object.values(candidate).find((value) => Array.isArray(value));
      if (Array.isArray(nestedArray)) {
        records = nestedArray;
        break;
      }
    }
  }
  const firstRecordKeys = records.length > 0 && records[0] && typeof records[0] === "object" ? Object.keys(records[0]) : [];
  return { records, responseKeys, firstRecordKeys };
}

function toStringValue(record: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractCategory(record: any, action: string): Category {
  const status = toStringValue(record, ["Status", "status"]);
  const reason = toStringValue(record, ["Reason", "reason", "ErrorCode", "errorCode", "Code", "ReasonCode"]);
  const message = toStringValue(record, ["Message", "message"]);
  const fallback = classify(reason, `${status ?? ""} ${message ?? ""}`.trim());
  if (fallback !== "temporary") return fallback;
  if (action.toLowerCase() === "queryinvalidaddress") {
    return "invalid";
  }
  return "temporary";
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
  const from = parseDateInput(normalizedRange.rawFrom)!;
  const to = parseDateInput(normalizedRange.rawTo)!;

  const mode = resolveMode();
  const credentials = resolveCredentials();
  const credentialsPresent = Boolean(credentials);
  const alibabaApiRange: AlibabaApiRange = {
    startTime: normalizedRange.startDay,
    endTime: normalizedRange.endDay
  };
  const errors: string[] = [];
  const warnings: string[] = [...normalizedRange.warnings];
  let apiRequestMade = false;
  let totalReportsReturned = 0; // kept for backward compatibility
  let totalRawRecords = 0;
  let parsedEmails = 0;
  let totalCount: number | null = null;
  let pagesFetched = 0;
  let nextStartLastValue: number | null = null;
  let responseKeys: string[] = [];
  let firstRecordKeys: string[] = [];
  let removedFromLists = 0;
  let listRemovalSkipped = 0;
  const finalParams: Array<{ startTime: string; endTime: string; length: number; nextStart: number | null }> = [];

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
      totalRawRecords,
      parsedEmails,
      totalCount,
      pagesFetched,
      nextStartLastValue,
      responseKeys,
      firstRecordKeys,
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
      const requestLength = 100;
      let nextStart: number | null = null;
      let page = 0;
      let previousNextStart: number | null = null;
      while (page < 200) {
        page += 1;
        finalParams.push({
          startTime: alibabaApiRange.startTime,
          endTime: alibabaApiRange.endTime,
          length: requestLength,
          nextStart
        });
        console.info("[alibaba.sync] params", {
          StartTime: alibabaApiRange.startTime,
          EndTime: alibabaApiRange.endTime,
          Length: requestLength,
          NextStart: nextStart
        });
        const signedUrl = buildSignedAlibabaUrl(
          credentials,
          action,
          alibabaApiRange.startTime,
          alibabaApiRange.endTime,
          requestLength,
          nextStart
        );
        apiRequestMade = true;
        const response = await fetch(signedUrl, { method: "GET", cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as any;
        const parserData = extractRawAlibabaRecords(payload);
        if (responseKeys.length === 0) responseKeys = parserData.responseKeys;
        if (firstRecordKeys.length === 0) firstRecordKeys = parserData.firstRecordKeys;
        if (totalCount === null) {
          totalCount =
            toNumericValue(payload?.Body?.TotalCount) ??
            toNumericValue(payload?.TotalCount) ??
            toNumericValue(payload?.Data?.TotalCount) ??
            toNumericValue(payload?.data?.TotalCount) ??
            toNumericValue(payload?.Body?.Data?.TotalCount);
        }

        totalRawRecords += parserData.records.length;
        totalReportsReturned = totalRawRecords;
        for (const record of parserData.records) {
          const emailRaw = toStringValue(record, [
            "ToAddress",
            "Email",
            "email",
            "Address",
            "address",
            "MailAddress",
            "RcptTo",
            "Recipient",
            "EmailAddress"
          ]);
          if (!emailRaw) continue;
          const emailNormalized = emailRaw.toLowerCase();
          if (!isValidEmail(emailNormalized)) continue;
          parsedEmails += 1;
          const category = extractCategory(record, action);
          const providerCode = toStringValue(record, ["ErrorCode", "errorCode", "Code", "ReasonCode", "Status", "status"]);
          const message = toStringValue(record, ["Message", "message", "Reason", "reason"]);
          reportRows.push({
            email: emailRaw,
            emailNormalized,
            providerCode,
            message: [message, category].filter(Boolean).join(" | ")
          });
        }
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
          typeof payload?.Body?.Data?.NextStart === "number"
            ? payload.Body.Data.NextStart
            : typeof payload?.Data?.NextStart === "number"
              ? payload.Data.NextStart
              : typeof payload?.NextStart === "number"
                ? payload.NextStart
                : typeof payload?.Body?.Data?.NextStart === "string"
                  ? Number(payload.Body.Data.NextStart)
                  : typeof payload?.Data?.NextStart === "string"
                    ? Number(payload.Data.NextStart)
                    : typeof payload?.NextStart === "string"
                      ? Number(payload.NextStart)
                      : null;
        if (typeof payloadNextStart === "number" && Number.isFinite(payloadNextStart) && payloadNextStart > 0) {
          nextStart = Math.floor(payloadNextStart);
          nextStartLastValue = nextStart;
        } else {
          nextStart = null;
        }
        pagesFetched = page;
        console.info("[alibaba.sync] page result", {
          page,
          rawCount: parserData.records.length,
          hasNextStart: nextStart !== null
        });
        if (nextStart === null) break;
        if (previousNextStart !== null && nextStart === previousNextStart) {
          warnings.push("Alibaba pagination returned same NextStart value. Loop stopped for safety.");
          break;
        }
        previousNextStart = nextStart;
      }
      if (pagesFetched >= 200 && nextStart !== null) {
        warnings.push("Alibaba pagination reached safety limit (200 pages).");
      }
      console.info("[alibaba.sync] parser", {
        responseKeys,
        firstRecordKeys,
        parsedEmails
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Alibaba API request failed");
      console.error("[alibaba.sync] request_failed", {
        StartTime: alibabaApiRange.startTime,
        EndTime: alibabaApiRange.endTime,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (mode === "mock") {
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
    totalRawRecords = logs.length;
    parsedEmails = logs.length;
    totalCount = logs.length;
    warnings.push("Mock mode aktif: Alibaba credentials/region eksik oldugu icin yerel log verisi kullanildi.");
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
  let ignoredUnknown = 0;
  const candidateMap = new Map<string, { email: string; emailNormalized: string; reason: string }>();

  for (const log of reportRows) {
    if (!log.emailNormalized) continue;
    scanned += 1;
    const category = classify(log.providerCode, log.message);
    if (category === "temporary") {
      ignoredTemporary += 1;
      continue;
    }
    if (!["invalid", "hard_bounce", "complaint", "blocked_rejected"].includes(category)) {
      ignoredUnknown += 1;
      continue;
    }
    if (!selected.has(category)) {
      ignoredByCategory += 1;
      continue;
    }
    candidateMap.set(log.emailNormalized, {
      email: log.email,
      emailNormalized: log.emailNormalized,
      reason:
        category === "invalid"
          ? "invalid_address"
          : category === "hard_bounce"
            ? "hard_bounce"
            : category === "complaint"
              ? "complaint"
              : "blocked_rejected"
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
        source: "alibaba",
        scope: "global"
      })),
      skipDuplicates: true
    });
    added += created.count;
  }

  if (parsed.data.removeFromLists && addable.length > 0) {
    let totalRecipientsMatched = 0;
    const emailChunks = chunk(
      addable.map((item) => item.emailNormalized),
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
    listRemovalSkipped = Math.max(0, addable.length - totalRecipientsMatched);
  } else {
    listRemovalSkipped = addable.length;
  }

  console.info("[suppression.sync_alibaba] list cleanup", {
    totalSuppressedFetched: totalRawRecords,
    totalSuppressedMatched: candidates.length,
    removedFromLists,
    listRemovalSkipped,
    removeFromListsEnabled: parsed.data.removeFromLists
  });
  console.info("[alibaba.sync] completed", {
    added,
    alreadySuppressed: existing.size,
    removedFromLists,
    ignoredTemporary,
    ignoredUnknown
  });

  const summary = {
    mode,
    dateRange: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    normalizedApiRange: {
      startTime: alibabaApiRange.startTime,
      endTime: alibabaApiRange.endTime
    },
    finalParams,
    warnings,
    credentialsPresent,
    apiRequestMade,
    totalReportsReturned,
    totalRawRecords,
    parsedEmails,
    totalCount,
    pagesFetched,
    nextStartLastValue,
    responseKeys,
    firstRecordKeys,
    scanned,
    selectedCategories: parsed.data.categories,
    matched: candidates.length,
    added,
    removedFromLists,
    listRemovalSkipped,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    ignoredUnknown,
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
    totalRawRecords,
    parsedEmails,
    totalCount,
    pagesFetched,
    nextStartLastValue,
    responseKeys,
    firstRecordKeys,
    scanned,
    matched: candidates.length,
    added,
    removedFromLists,
    listRemovalSkipped,
    alreadySuppressed: existing.size,
    ignoredTemporary,
    ignoredUnknown,
    ignoredByCategory,
    errors
  });
}
