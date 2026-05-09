import crypto from "node:crypto";
import { prisma } from "@nexus/db";

type AlibabaCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
};

type SyncStatus = "idle" | "running" | "paused" | "completed" | "failed" | "stopped_limit";

export type AlibabaSyncPublicStatus = {
  status: SyncStatus;
  startTime: string;
  endTime: string;
  totalCount: number;
  pagesFetched: number;
  rawRecords: number;
  parsedEmails: number;
  addedToSuppression: number;
  alreadySuppressed: number;
  removedFromLists: number;
  invalidEmailSkipped: number;
  ignoredTemporary: number;
  ignoredUnknown: number;
  hasNextStart: boolean;
  nextStartHash: string | null;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  message: string;
  responseKeys: string[];
  firstRecordKeys: string[];
  parserPathUsed: string | null;
};

type SyncRunInput = {
  startTime?: string;
  endTime?: string;
  removeFromLists: boolean;
  reset: boolean;
};

type Candidate = {
  email: string;
  emailNormalized: string;
  reason: "invalid_address";
};

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
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

function buildSignedAlibabaUrl(
  credentials: AlibabaCredentials,
  startTime: string,
  endTime: string,
  pageSize: number,
  nextStart: string | null
): string {
  const endpoint = process.env.ALIBABA_DM_API_ENDPOINT ?? `https://dm.${credentials.region}.aliyuncs.com/`;
  const nonce = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const params = new URLSearchParams({
    Action: "QueryInvalidAddress",
    Format: "JSON",
    Version: "2015-11-23",
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: nonce,
    Timestamp: timestamp,
    RegionId: credentials.region,
    StartTime: startTime,
    EndTime: endTime,
    Length: String(Math.max(1, pageSize))
  });
  if (typeof nextStart === "string" && nextStart.trim() && nextStart.trim() !== "-") {
    params.set("NextStart", nextStart.trim());
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

function extractRecordsFromObject(value: any, collector: any[]): boolean {
  if (!value || typeof value !== "object") return false;
  let used = false;
  for (const key of ["mailDetail", "MailDetail", "mailDetails"]) {
    const candidate = value?.[key];
    if (Array.isArray(candidate)) {
      collector.push(...candidate);
      used = true;
    }
  }
  const hasDirectEmailField = Boolean(
    value.ToAddress ||
      value.toAddress ||
      value.Email ||
      value.email ||
      value.Address ||
      value.address ||
      value.MailAddress ||
      value.mailAddress ||
      value.RcptTo ||
      value.rcptTo
  );
  if (hasDirectEmailField) {
    collector.push(value);
    used = true;
  }
  return used;
}

function extractAlibabaInvalidAddressRecords(payload: any): {
  records: any[];
  responseKeys: string[];
  firstRecordKeys: string[];
  parserPathUsed: string | null;
} {
  const root = payload?.Body && typeof payload.Body === "object" ? payload.Body : payload;
  const containers: Array<{ label: string; value: any }> = [];
  if (root?.Data) containers.push({ label: "Data", value: root.Data });
  if (root?.data) containers.push({ label: "data", value: root.data });
  if (payload?.Body?.Data) containers.push({ label: "Body.Data", value: payload.Body.Data });
  if (payload?.body?.data) containers.push({ label: "body.data", value: payload.body.data });

  const records: any[] = [];
  let parserPathUsed: string | null = null;
  for (const container of containers) {
    if (Array.isArray(container.value)) {
      for (const item of container.value) {
        const used = extractRecordsFromObject(item, records);
        if (used && !parserPathUsed) parserPathUsed = `${container.label}[]`;
      }
      continue;
    }
    const used = extractRecordsFromObject(container.value, records);
    if (used && !parserPathUsed) parserPathUsed = container.label;
  }

  return {
    records,
    responseKeys: Object.keys(root ?? {}),
    firstRecordKeys: records.length > 0 && records[0] && typeof records[0] === "object" ? Object.keys(records[0]) : [],
    parserPathUsed
  };
}

function extractNextStart(payload: any): string | null {
  const candidates = [
    payload?.Body?.Data?.NextStart,
    payload?.Body?.Data?.nextStart,
    payload?.Body?.NextStart,
    payload?.Body?.nextStart,
    payload?.Data?.NextStart,
    payload?.Data?.nextStart,
    payload?.data?.NextStart,
    payload?.data?.nextStart,
    payload?.NextStart,
    payload?.nextStart
  ];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (!normalized || normalized === "-" || normalized.toLowerCase() === "null") continue;
    return normalized;
  }
  return null;
}

function toNumericValue(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toEmail(record: any): string | null {
  const keys = [
    "ToAddress",
    "toAddress",
    "Email",
    "email",
    "Address",
    "address",
    "MailAddress",
    "mailAddress",
    "RcptTo",
    "rcptTo"
  ];
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashNextStart(nextStart: string | null): string | null {
  if (!nextStart) return null;
  return crypto.createHash("sha256").update(nextStart).digest("hex").slice(0, 12);
}

async function applySuppressionBatch(candidates: Candidate[], removeFromLists: boolean) {
  if (candidates.length === 0) {
    return { addedToSuppression: 0, alreadySuppressed: 0, removedFromLists: 0 };
  }
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
  let addedToSuppression = 0;
  for (const candidateChunk of chunk(addable, 1000)) {
    const created = await prisma.suppressionEntry.createMany({
      data: candidateChunk.map((item) => ({
        email: item.email,
        emailNormalized: item.emailNormalized,
        reason: "invalid_address",
        source: "alibaba_query_invalid_address",
        scope: "global"
      })),
      skipDuplicates: true
    });
    addedToSuppression += created.count;
  }
  let removedFromLists = 0;
  if (removeFromLists) {
    for (const emailChunk of chunk(candidates.map((item) => item.emailNormalized), 2000)) {
      const matchedRecipients = await prisma.recipient.findMany({
        where: { emailNormalized: { in: emailChunk } },
        select: { id: true }
      });
      if (matchedRecipients.length === 0) continue;
      for (const recipientChunk of chunk(matchedRecipients.map((row: { id: string }) => row.id), 2000)) {
        const deleted = await prisma.recipientListMembership.deleteMany({
          where: { recipientId: { in: recipientChunk } }
        });
        removedFromLists += deleted.count;
      }
    }
  }
  return {
    addedToSuppression,
    alreadySuppressed: Math.max(0, existing.size + (addable.length - addedToSuppression)),
    removedFromLists
  };
}

function toPublicStatus(row: any, message: string): AlibabaSyncPublicStatus {
  return {
    status: row.status as SyncStatus,
    startTime: row.startTime,
    endTime: row.endTime,
    totalCount: Number(row.totalCount ?? 0),
    pagesFetched: Number(row.pagesFetched ?? 0),
    rawRecords: Number(row.rawRecords ?? 0),
    parsedEmails: Number(row.parsedEmails ?? 0),
    addedToSuppression: Number(row.addedToSuppression ?? 0),
    alreadySuppressed: Number(row.alreadySuppressed ?? 0),
    removedFromLists: Number(row.removedFromLists ?? 0),
    invalidEmailSkipped: Number(row.invalidEmailSkipped ?? 0),
    ignoredTemporary: Number(row.ignoredTemporary ?? 0),
    ignoredUnknown: Number(row.ignoredUnknown ?? 0),
    hasNextStart: Boolean(row.nextStart),
    nextStartHash: row.nextStartHash ?? null,
    lastError: row.lastError ?? null,
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    message,
    responseKeys: Array.isArray(row.responseKeys) ? row.responseKeys : [],
    firstRecordKeys: Array.isArray(row.firstRecordKeys) ? row.firstRecordKeys : [],
    parserPathUsed: typeof row.parserPathUsed === "string" ? row.parserPathUsed : null
  };
}

export async function getAlibabaSyncStatus(): Promise<AlibabaSyncPublicStatus> {
  const row = await prisma.appSetting.findUnique({ where: { key: "alibaba_sync_state_v1" } });
  if (!row?.value || typeof row.value !== "object") {
    return {
      status: "idle",
      startTime: "",
      endTime: "",
      totalCount: 0,
      pagesFetched: 0,
      rawRecords: 0,
      parsedEmails: 0,
      addedToSuppression: 0,
      alreadySuppressed: 0,
      removedFromLists: 0,
      invalidEmailSkipped: 0,
      ignoredTemporary: 0,
      ignoredUnknown: 0,
      hasNextStart: false,
      nextStartHash: null,
      lastError: null,
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      message: "Hazir",
      responseKeys: [],
      firstRecordKeys: [],
      parserPathUsed: null
    };
  }
  return toPublicStatus(row.value as any, "Durum guncel");
}

async function persistState(next: Record<string, unknown>) {
  await prisma.appSetting.upsert({
    where: { key: "alibaba_sync_state_v1" },
    create: { key: "alibaba_sync_state_v1", value: next },
    update: { value: next }
  });
}

export async function resetAlibabaSyncState() {
  const resetState = {
    status: "idle",
    startTime: "",
    endTime: "",
    nextStart: null,
    nextStartHash: null,
    totalCount: 0,
    pagesFetched: 0,
    rawRecords: 0,
    parsedEmails: 0,
    addedToSuppression: 0,
    alreadySuppressed: 0,
    removedFromLists: 0,
    invalidEmailSkipped: 0,
    ignoredTemporary: 0,
    ignoredUnknown: 0,
    lastError: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    completedAt: null,
    responseKeys: [],
    firstRecordKeys: [],
    parserPathUsed: null
  };
  await persistState(resetState);
  return toPublicStatus(resetState, "Sifirlandi");
}

export async function runAlibabaSync(input: SyncRunInput): Promise<AlibabaSyncPublicStatus> {
  const credentials = resolveCredentials();
  if (!credentials) {
    throw new Error("Alibaba kimlik bilgileri bulunamadi.");
  }
  const pageSize = Math.max(1, Number(process.env.ALIBABA_SYNC_PAGE_SIZE ?? 100));
  const pagesPerRun = Math.max(1, Number(process.env.ALIBABA_SYNC_PAGES_PER_RUN ?? 50));
  const maxTotalPages = Math.max(1, Number(process.env.ALIBABA_SYNC_MAX_TOTAL_PAGES ?? 10000));

  const current = await getAlibabaSyncStatus();
  const base = input.reset
    ? {
        ...current,
        startTime: input.startTime ?? current.startTime,
        endTime: input.endTime ?? current.endTime,
        nextStart: null,
        nextStartHash: null,
        totalCount: 0,
        pagesFetched: 0,
        rawRecords: 0,
        parsedEmails: 0,
        addedToSuppression: 0,
        alreadySuppressed: 0,
        removedFromLists: 0,
        invalidEmailSkipped: 0,
        ignoredTemporary: 0,
        ignoredUnknown: 0,
        lastError: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        responseKeys: [] as string[],
        firstRecordKeys: [] as string[],
        parserPathUsed: null as string | null
      }
    : {
        ...current,
        startTime: current.startTime || input.startTime || "",
        endTime: current.endTime || input.endTime || "",
        status: "running" as SyncStatus,
        lastError: null
      };

  if (!base.startTime || !base.endTime) {
    throw new Error("Senkronizasyon icin tarih araligi gerekli.");
  }

  let nextStart: string | null = input.reset ? null : (current.hasNextStart ? (current.nextStartHash ? null : null) : null);
  // raw nextStart is kept in private AppSetting payload only
  const row = await prisma.appSetting.findUnique({ where: { key: "alibaba_sync_state_v1" } });
  if (!input.reset && row?.value && typeof row.value === "object") {
    nextStart = (row.value as any).nextStart ?? null;
  }

  let responseKeys = base.responseKeys ?? [];
  let firstRecordKeys = base.firstRecordKeys ?? [];
  let parserPathUsed = base.parserPathUsed ?? null;
  let totalCount = Number(base.totalCount ?? 0);
  let pagesFetched = Number(base.pagesFetched ?? 0);
  let rawRecords = Number(base.rawRecords ?? 0);
  let parsedEmails = Number(base.parsedEmails ?? 0);
  let addedToSuppression = Number(base.addedToSuppression ?? 0);
  let alreadySuppressed = Number(base.alreadySuppressed ?? 0);
  let removedFromLists = Number(base.removedFromLists ?? 0);
  let invalidEmailSkipped = Number(base.invalidEmailSkipped ?? 0);
  let ignoredTemporary = Number(base.ignoredTemporary ?? 0);
  let ignoredUnknown = Number(base.ignoredUnknown ?? 0);
  let lastError: string | null = null;

  for (let i = 0; i < pagesPerRun; i += 1) {
    if (pagesFetched >= maxTotalPages) {
      const stopped = {
        ...base,
        status: "stopped_limit",
        nextStart,
        nextStartHash: hashNextStart(nextStart),
        totalCount,
        pagesFetched,
        rawRecords,
        parsedEmails,
        addedToSuppression,
        alreadySuppressed,
        removedFromLists,
        invalidEmailSkipped,
        ignoredTemporary,
        ignoredUnknown,
        lastError: null,
        updatedAt: new Date().toISOString(),
        completedAt: null,
        responseKeys,
        firstRecordKeys,
        parserPathUsed
      };
      await persistState(stopped);
      return toPublicStatus(
        stopped,
        "Cok fazla kayit var, islem guvenlik limiti nedeniyle durduruldu. Devam etmek icin tekrar calistirin."
      );
    }

    const url = buildSignedAlibabaUrl(credentials, base.startTime, base.endTime, pageSize, nextStart);
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      lastError = payload?.Message ? String(payload.Message) : `Alibaba API hatasi: ${response.status}`;
      break;
    }

    const parser = extractAlibabaInvalidAddressRecords(payload);
    if (responseKeys.length === 0) responseKeys = parser.responseKeys;
    if (firstRecordKeys.length === 0) firstRecordKeys = parser.firstRecordKeys;
    if (!parserPathUsed && parser.parserPathUsed) parserPathUsed = parser.parserPathUsed;

    if (!totalCount) {
      totalCount =
        toNumericValue(payload?.Body?.TotalCount) ??
        toNumericValue(payload?.TotalCount) ??
        toNumericValue(payload?.Data?.TotalCount) ??
        toNumericValue(payload?.data?.TotalCount) ??
        0;
    }

    rawRecords += parser.records.length;
    const pageCandidatesMap = new Map<string, Candidate>();
    for (const record of parser.records) {
      const rawEmail = toEmail(record);
      if (!rawEmail) {
        invalidEmailSkipped += 1;
        continue;
      }
      const emailNormalized = rawEmail.trim().toLowerCase();
      if (!isValidEmail(emailNormalized)) {
        invalidEmailSkipped += 1;
        continue;
      }
      parsedEmails += 1;
      pageCandidatesMap.set(emailNormalized, {
        email: rawEmail.trim(),
        emailNormalized,
        reason: "invalid_address"
      });
    }

    const pageCandidates = [...pageCandidatesMap.values()];
    const batchSummary = await applySuppressionBatch(pageCandidates, input.removeFromLists);
    addedToSuppression += batchSummary.addedToSuppression;
    alreadySuppressed += batchSummary.alreadySuppressed;
    removedFromLists += batchSummary.removedFromLists;
    pagesFetched += 1;

    const extractedNextStart = extractNextStart(payload);
    nextStart = extractedNextStart;
    if (!nextStart) break;
  }

  const hasNextStart = Boolean(nextStart);
  const status: SyncStatus = lastError
    ? "failed"
    : hasNextStart
      ? "paused"
      : "completed";

  const finalState = {
    ...base,
    status,
    nextStart,
    nextStartHash: hashNextStart(nextStart),
    totalCount,
    pagesFetched,
    rawRecords,
    parsedEmails,
    addedToSuppression,
    alreadySuppressed,
    removedFromLists,
    invalidEmailSkipped,
    ignoredTemporary,
    ignoredUnknown,
    lastError,
    updatedAt: new Date().toISOString(),
    completedAt: status === "completed" ? new Date().toISOString() : null,
    responseKeys,
    firstRecordKeys,
    parserPathUsed
  };
  await persistState(finalState);

  let message = "Senkronizasyon tamamlandi.";
  if (status === "paused") {
    message = "Bu calistirmada guvenlik limiti kadar kayit islendi. Kalan kayitlar icin Devam Et butonunu kullanabilirsiniz.";
  }
  if (status === "failed") {
    message = `Senkronizasyon hatasi: ${lastError ?? "bilinmeyen hata"}`;
  }
  if (totalCount > 0 && parsedEmails === 0) {
    message = "Alibaba kayit dondurdu ancak e-posta alani okunamadi. Beklenen alan: data.mailDetail[].ToAddress";
  }
  return toPublicStatus(finalState, message);
}
