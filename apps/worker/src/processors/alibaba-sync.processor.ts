import crypto from "node:crypto";
import type { Job } from "bullmq";
import { prisma } from "@nexus/db";
import { alibabaSuppressionSyncQueue, safeJobId, type AlibabaSuppressionSyncJob } from "@nexus/queue";
import {
  classifyAlibabaSyncError,
  isRecoverableBullmqLockOrJobIdError,
  isRetryableFailureCode,
  truncateMessage
} from "./alibaba-sync-error-classify.js";

type SyncStatus = "idle" | "running" | "retrying" | "paused" | "completed" | "failed" | "cancelling" | "stopped_limit";

const PAGE_SIZE = Math.max(1, Number(process.env.ALIBABA_SYNC_PAGE_SIZE ?? 100));
const BATCH_PAGES = Math.max(1, Number(process.env.ALIBABA_SYNC_BATCH_PAGES ?? 50));
const LOOP_DELAY_MS = Math.max(0, Number(process.env.ALIBABA_SYNC_LOOP_DELAY_MS ?? 50));
const DB_CHUNK_SIZE = Math.max(100, Number(process.env.ALIBABA_SYNC_DB_CHUNK_SIZE ?? 5000));
const REMOVE_CHUNK_SIZE = Math.max(100, Number(process.env.ALIBABA_SYNC_REMOVE_CHUNK_SIZE ?? 5000));
const MAX_RUNTIME_MS = Math.max(0, Number(process.env.ALIBABA_SYNC_MAX_RUNTIME_MS ?? 0));
const AUTO_CONTINUE = String(process.env.ALIBABA_SYNC_AUTO_CONTINUE ?? "true").toLowerCase() !== "false";
const EMPTY_PARSER_FAIL_STREAK = Math.max(3, Number(process.env.ALIBABA_SYNC_EMPTY_PARSER_FAIL_STREAK ?? 8));

type Candidate = { email: string; emailNormalized: string };

/** BullMQ custom jobId must not contain ":"; keep length bounded. */
function alibabaSyncBullmqJobId(kind: string, syncStateId: string) {
  return safeJobId(`alibaba-sync-${kind}-${syncStateId}-${Date.now()}`).slice(0, 120);
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

function hashNextStart(nextStart: string | null): string | null {
  if (!nextStart) return null;
  return crypto.createHash("sha256").update(nextStart).digest("hex").slice(0, 8);
}

function getMeta(raw: unknown) {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    responseKeys: Array.isArray(obj.responseKeys) ? (obj.responseKeys as string[]) : [],
    firstRecordKeys: Array.isArray(obj.firstRecordKeys) ? (obj.firstRecordKeys as string[]) : [],
    parserPathUsed: typeof obj.parserPathUsed === "string" ? (obj.parserPathUsed as string) : null,
    processedNextStartHashes: Array.isArray(obj.processedNextStartHashes)
      ? ((obj.processedNextStartHashes as string[]).filter(Boolean).slice(-500))
      : [],
    runPagesFetched: Number(obj.runPagesFetched ?? 0),
    runRawRecords: Number(obj.runRawRecords ?? 0),
    runParsedEmails: Number(obj.runParsedEmails ?? 0),
    runAddedToSuppression: Number(obj.runAddedToSuppression ?? 0),
    runAlreadySuppressed: Number(obj.runAlreadySuppressed ?? 0),
    runRemovedFromLists: Number(obj.runRemovedFromLists ?? 0),
    workerJobId: typeof obj.workerJobId === "string" ? obj.workerJobId : null,
    batchPages: Number(obj.batchPages ?? BATCH_PAGES),
    pageSize: Number(obj.pageSize ?? PAGE_SIZE),
    nextStartLength: Number(obj.nextStartLength ?? 0),
    emptyParserPageStreak: Number(obj.emptyParserPageStreak ?? 0)
  };
}

function resolveCredentials() {
  const accessKeyId =
    process.env.ALIBABA_DM_ACCESS_KEY_ID ??
    process.env.ALIBABA_ACCESS_KEY_ID ??
    process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret =
    process.env.ALIBABA_DM_ACCESS_KEY_SECRET ??
    process.env.ALIBABA_ACCESS_KEY_SECRET ??
    process.env.ALIYUN_ACCESS_KEY_SECRET;
  const region =
    process.env.ALIBABA_DM_REGION ?? process.env.ALIBABA_REGION ?? process.env.ALIYUN_REGION;
  if (!accessKeyId || !accessKeySecret || !region) return null;
  return { accessKeyId, accessKeySecret, region };
}

function buildSignedAlibabaUrl(
  credentials: { accessKeyId: string; accessKeySecret: string; region: string },
  startTime: string,
  endTime: string,
  pageSize: number,
  nextStart: string | null
) {
  const endpoint = process.env.ALIBABA_DM_API_ENDPOINT ?? `https://dm.${credentials.region}.aliyuncs.com/`;
  const nonce = crypto.randomUUID();
  const params = new URLSearchParams({
    Action: "QueryInvalidAddress",
    Format: "JSON",
    Version: "2015-11-23",
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: nonce,
    Timestamp: new Date().toISOString(),
    RegionId: credentials.region,
    StartTime: startTime,
    EndTime: endTime,
    Length: String(Math.max(1, pageSize))
  });
  if (nextStart && nextStart.trim() && nextStart.trim() !== "-") {
    params.set("NextStart", nextStart.trim());
  }
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const canonicalized = sorted.map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join("&");
  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonicalized)}`;
  const signature = crypto.createHmac("sha1", `${credentials.accessKeySecret}&`).update(stringToSign).digest("base64");
  const url = new URL(endpoint);
  for (const [k, v] of sorted) url.searchParams.set(k, v);
  url.searchParams.set("Signature", signature);
  return url.toString();
}

function extractFromObject(value: any, collector: any[]) {
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

function extractAlibabaRecords(payload: any) {
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
        const used = extractFromObject(item, records);
        if (used && !parserPathUsed) parserPathUsed = `${container.label}[]`;
      }
      continue;
    }
    const used = extractFromObject(container.value, records);
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

function extractAlibabaApiCodeMessage(payload: any): { code?: string; message?: string } {
  const code =
    payload?.Code ??
    payload?.code ??
    payload?.Body?.Code ??
    payload?.Body?.code ??
    payload?.ErrorCode ??
    payload?.errorCode;
  const message =
    payload?.Message ??
    payload?.message ??
    payload?.Body?.Message ??
    payload?.Body?.message ??
    payload?.error?.message;
  return {
    code: code != null ? String(code) : undefined,
    message: message != null ? String(message) : undefined
  };
}

function isAlibabaSuccessPayload(payload: any): boolean {
  const { code } = extractAlibabaApiCodeMessage(payload);
  if (!code) return true;
  const c = code.toLowerCase();
  return c === "ok" || c === "success";
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

function backoffMs(consecutiveFailures: number) {
  return Math.min(60_000, Math.pow(2, Math.max(1, consecutiveFailures)) * 2000);
}

async function applySuppressionBatch(candidates: Candidate[], removeFromLists: boolean) {
  if (candidates.length === 0) {
    return { addedToSuppression: 0, alreadySuppressed: 0, removedFromLists: 0, listRemovalWarning: null as string | null };
  }
  const existing = new Set<string>();
  for (const candidateChunk of chunk(candidates, DB_CHUNK_SIZE)) {
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
  for (const candidateChunk of chunk(addable, DB_CHUNK_SIZE)) {
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
  let listRemovalWarning: string | null = null;
  if (removeFromLists) {
    try {
      for (const emailChunk of chunk(candidates.map((item) => item.emailNormalized), REMOVE_CHUNK_SIZE)) {
        const recipients = await prisma.recipient.findMany({
          where: { emailNormalized: { in: emailChunk } },
          select: { id: true }
        });
        if (recipients.length === 0) continue;
        for (const recipientChunk of chunk(recipients.map((row: { id: string }) => row.id), REMOVE_CHUNK_SIZE)) {
          try {
            const deleted = await prisma.recipientListMembership.deleteMany({
              where: { recipientId: { in: recipientChunk } }
            });
            removedFromLists += deleted.count;
          } catch (inner: unknown) {
            const msg = inner instanceof Error ? inner.message : String(inner);
            const prismaCode =
              inner && typeof inner === "object" && "code" in inner ? String((inner as { code?: string }).code) : "";
            const kind = classifyAlibabaSyncError({ message: msg, prismaCode });
            if (kind.retryable) throw inner;
            listRemovalWarning = truncateMessage(msg, 180);
            console.warn("[alibaba.sync] list_removal_chunk_skipped", { code: kind.code });
          }
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const prismaCode =
        error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
      const kind = classifyAlibabaSyncError({ message: msg, prismaCode });
      if (kind.retryable) throw error;
      listRemovalWarning = truncateMessage(msg, 180);
      console.warn("[alibaba.sync] list_removal_partial", { code: kind.code });
    }
  }
  return {
    addedToSuppression,
    alreadySuppressed: Math.max(0, existing.size + (addable.length - addedToSuppression)),
    removedFromLists,
    listRemovalWarning
  };
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function markPaused(syncStateId: string) {
  await prisma.alibabaSuppressionSyncState.update({
    where: { id: syncStateId },
    data: {
      status: "paused",
      stopRequested: false,
      lockOwner: null,
      lockedAt: null,
      nextRetryAt: null
    }
  });
}

async function releaseLockIfHeld(syncStateId: string, lockOwner: string) {
  await prisma.alibabaSuppressionSyncState.updateMany({
    where: { id: syncStateId, lockOwner },
    data: { lockOwner: null, lockedAt: null }
  });
}

async function acquireAlibabaSyncLock(syncStateId: string, lockOwner: string) {
  const staleThreshold = new Date(Date.now() - 2 * 60_000);
  const now = new Date();
  const freeLock = {
    OR: [{ lockOwner: null }, { lockedAt: { lt: staleThreshold } }, { lockOwner }] as const
  };

  const runningBranch = { status: "running" as const, ...freeLock };
  const retryingDue = { status: "retrying" as const, nextRetryAt: { lte: now }, ...freeLock };
  const retryingNull = { status: "retrying" as const, nextRetryAt: null, ...freeLock };

  const lockUpdate = await prisma.alibabaSuppressionSyncState.updateMany({
    where: {
      id: syncStateId,
      OR: [runningBranch, retryingDue, retryingNull]
    },
    data: {
      lockOwner,
      lockedAt: new Date(),
      status: "running",
      nextRetryAt: null,
      lastRetryAt: new Date()
    }
  });
  return lockUpdate.count > 0;
}

async function finalizeFailure(
  syncStateId: string,
  kind: ReturnType<typeof classifyAlibabaSyncError>,
  consecutiveFailures: number,
  maxRetries: number,
  currentRetryCount: number
) {
  const nextCf = consecutiveFailures + 1;
  if (!kind.retryable || nextCf >= maxRetries) {
    const userMsg =
      kind.retryable && nextCf >= maxRetries
        ? "Senkronizasyon geçici hatalar nedeniyle durduruldu. Devam Ettir ile kaldığı yerden tekrar deneyebilirsiniz."
        : kind.shortMessage;
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: syncStateId },
      data: {
        status: "failed",
        lastError: userMsg.slice(0, 500),
        lastFailureAt: new Date(),
        lastFailureCode: kind.code,
        lastFailureMessage: kind.shortMessage.slice(0, 500),
        consecutiveFailures: nextCf,
        lockOwner: null,
        lockedAt: null,
        nextRetryAt: null
      }
    });
    console.info("[alibaba.sync.failed]", { errorCode: kind.code, shortMessage: kind.shortMessage });
    return;
  }

  const delayMs = backoffMs(nextCf);
  const nextRetryAt = new Date(Date.now() + delayMs);
  const retryLastError =
    kind.code === "BULLMQ_JOB_ID_OR_LOCK"
      ? "Geçici kuyruk hatası alındı, işlem kaldığı yerden devam edecek."
      : kind.shortMessage.slice(0, 500);
  await prisma.alibabaSuppressionSyncState.update({
    where: { id: syncStateId },
    data: {
      status: "retrying",
      lastError: retryLastError,
      lastFailureAt: new Date(),
      lastFailureCode: kind.code,
      lastFailureMessage: kind.shortMessage.slice(0, 500),
      consecutiveFailures: nextCf,
      retryCount: currentRetryCount + 1,
      nextRetryAt,
      lockOwner: null,
      lockedAt: null
    }
  });
  console.info("[alibaba.sync.retry]", {
    errorCode: kind.code,
    retryable: true,
    consecutiveFailures: nextCf,
    nextRetryAt: nextRetryAt.toISOString()
  });
  await alibabaSuppressionSyncQueue.add(
    "alibaba_suppression_sync",
    { syncStateId, trigger: "auto" },
    { delay: delayMs, jobId: alibabaSyncBullmqJobId("retry", syncStateId) }
  );
}

export async function processAlibabaSuppressionSync(job: Job<AlibabaSuppressionSyncJob>) {
  const syncStateId = job.data.syncStateId;
  const credentials = resolveCredentials();
  if (!credentials) {
    const kind = classifyAlibabaSyncError({ message: "missing alibaba credentials", alibabaCode: "MissingConfig" });
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: syncStateId },
      data: {
        status: "failed",
        lastError: "Alibaba kimlik bilgileri bulunamadı.",
        lastFailureAt: new Date(),
        lastFailureCode: "config_missing",
        lastFailureMessage: kind.shortMessage,
        lockOwner: null,
        lockedAt: null,
        nextRetryAt: null
      }
    });
    console.info("[alibaba.sync.failed]", { errorCode: "config_missing", shortMessage: "credentials missing" });
    return;
  }

  const lockOwner = `worker:${process.pid}:${job.id}`;
  const acquired = await acquireAlibabaSyncLock(syncStateId, lockOwner);
  if (!acquired) return;

  const started = Date.now();
  try {
    for (let page = 0; page < BATCH_PAGES; page += 1) {
      const state = await prisma.alibabaSuppressionSyncState.findUnique({ where: { id: syncStateId } });
      if (!state) {
        await releaseLockIfHeld(syncStateId, lockOwner);
        return;
      }
      if (state.status !== "running") {
        await releaseLockIfHeld(syncStateId, lockOwner);
        return;
      }
      if (state.stopRequested) {
        await markPaused(syncStateId);
        return;
      }
      if (MAX_RUNTIME_MS > 0 && Date.now() - started > MAX_RUNTIME_MS) {
        await prisma.alibabaSuppressionSyncState.update({
          where: { id: syncStateId },
          data: { status: "paused", stopRequested: false, lockOwner: null, lockedAt: null, nextRetryAt: null }
        });
        return;
      }

      const meta = getMeta(state.meta);
      const maxRetries = Math.max(1, Number(state.maxRetries ?? 10));
      const currentRetryCount = Number(state.retryCount ?? 0);
      const consecutiveFailures = Number(state.consecutiveFailures ?? 0);

      let response: Response;
      let payload: any;
      try {
        const url = buildSignedAlibabaUrl(credentials, state.startTime, state.endTime, PAGE_SIZE, state.nextStart);
        response = await fetch(url, { method: "GET", cache: "no-store" });
        payload = (await response.json().catch(() => ({}))) as any;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        const kind = classifyAlibabaSyncError({ message: msg, causeMessage: (error as Error)?.cause ? String((error as Error).cause) : "" });
        await finalizeFailure(syncStateId, kind, consecutiveFailures, maxRetries, currentRetryCount);
        return;
      }

      const aliMeta = extractAlibabaApiCodeMessage(payload);
      if (!response.ok) {
        const kind = classifyAlibabaSyncError({
          httpStatus: response.status,
          message: aliMeta.message ?? payload?.Message,
          alibabaCode: aliMeta.code
        });
        await finalizeFailure(syncStateId, kind, consecutiveFailures, maxRetries, currentRetryCount);
        return;
      }

      if (!isAlibabaSuccessPayload(payload)) {
        const kind = classifyAlibabaSyncError({
          httpStatus: 200,
          message: aliMeta.message,
          alibabaCode: aliMeta.code
        });
        await finalizeFailure(syncStateId, kind, consecutiveFailures, maxRetries, currentRetryCount);
        return;
      }

      const parser = extractAlibabaRecords(payload);
      const responseKeys = meta.responseKeys.length === 0 ? parser.responseKeys : meta.responseKeys;
      const firstRecordKeys = meta.firstRecordKeys.length === 0 ? parser.firstRecordKeys : meta.firstRecordKeys;
      const parserPathUsed = meta.parserPathUsed ?? parser.parserPathUsed ?? null;
      const totalCount =
        Number(state.totalCount ?? 0) ||
        toNumericValue(payload?.Body?.TotalCount) ||
        toNumericValue(payload?.TotalCount) ||
        toNumericValue(payload?.Data?.TotalCount) ||
        toNumericValue(payload?.data?.TotalCount) ||
        0;

      const pageCandidatesMap = new Map<string, Candidate>();
      let invalidEmailSkipped = 0;
      let parsedEmails = 0;
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
        pageCandidatesMap.set(emailNormalized, { email: rawEmail.trim(), emailNormalized });
      }
      const pageCandidates = [...pageCandidatesMap.values()];

      let batchSummary: Awaited<ReturnType<typeof applySuppressionBatch>>;
      try {
        batchSummary = await applySuppressionBatch(pageCandidates, Boolean(state.removeFromLists));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        const prismaCode =
          error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
        const kind = classifyAlibabaSyncError({ message: msg, prismaCode });
        await finalizeFailure(syncStateId, kind, consecutiveFailures, maxRetries, currentRetryCount);
        return;
      }

      const extractedNextStart = extractNextStart(payload);
      const extractedHash = hashNextStart(extractedNextStart);
      if (extractedHash && meta.processedNextStartHashes.includes(extractedHash)) {
        const kind = classifyAlibabaSyncError({
          message: "NextStart loop detected",
          alibabaCode: "NextStartLoop"
        });
        const permanent = { ...kind, retryable: false };
        await finalizeFailure(syncStateId, permanent, consecutiveFailures, maxRetries, currentRetryCount);
        return;
      }

      let emptyParserPageStreak = meta.emptyParserPageStreak;
      if (parser.records.length === 0 && totalCount > 0) {
        const rawSoFar = Number(state.rawRecords ?? 0);
        const looksIncomplete = Boolean(extractedNextStart) || rawSoFar < totalCount;
        if (looksIncomplete) {
          emptyParserPageStreak += 1;
        }
      } else {
        emptyParserPageStreak = 0;
      }
      if (emptyParserPageStreak >= EMPTY_PARSER_FAIL_STREAK) {
        const kind = classifyAlibabaSyncError({
          message: "Parser returned no records repeatedly",
          alibabaCode: "EmptyParserStreak"
        });
        const permanent = { ...kind, retryable: false };
        await finalizeFailure(syncStateId, permanent, consecutiveFailures, maxRetries, currentRetryCount);
        return;
      }

      const processedNextStartHashes = extractedHash
        ? [...meta.processedNextStartHashes, extractedHash].slice(-500)
        : meta.processedNextStartHashes;
      const nextStatus: SyncStatus = extractedNextStart ? "running" : "completed";

      await prisma.alibabaSuppressionSyncState.update({
        where: { id: syncStateId },
        data: {
          status: nextStatus,
          nextStart: extractedNextStart,
          nextStartHash: extractedHash,
          totalCount: Number(totalCount),
          pagesFetched: { increment: 1 },
          rawRecords: { increment: parser.records.length },
          parsedEmails: { increment: parsedEmails },
          addedToSuppression: { increment: batchSummary.addedToSuppression },
          alreadySuppressed: { increment: batchSummary.alreadySuppressed },
          removedFromLists: { increment: batchSummary.removedFromLists },
          invalidEmailSkipped: { increment: invalidEmailSkipped },
          lastError: null,
          consecutiveFailures: 0,
          lastFailureCode: null,
          lastFailureMessage: null,
          nextRetryAt: null,
          completedAt: nextStatus === "completed" ? new Date() : null,
          lockedAt: new Date(),
          meta: {
            ...meta,
            responseKeys,
            firstRecordKeys,
            parserPathUsed,
            processedNextStartHashes,
            emptyParserPageStreak,
            runPagesFetched: meta.runPagesFetched + 1,
            runRawRecords: meta.runRawRecords + parser.records.length,
            runParsedEmails: meta.runParsedEmails + parsedEmails,
            runAddedToSuppression: meta.runAddedToSuppression + batchSummary.addedToSuppression,
            runAlreadySuppressed: meta.runAlreadySuppressed + batchSummary.alreadySuppressed,
            runRemovedFromLists: meta.runRemovedFromLists + batchSummary.removedFromLists,
            nextStartLength: extractedNextStart ? extractedNextStart.length : 0,
            batchPages: BATCH_PAGES,
            pageSize: PAGE_SIZE
          }
        }
      });

      if (batchSummary.listRemovalWarning) {
        console.warn("[alibaba.sync] list_removal_warning", { message: batchSummary.listRemovalWarning });
      }

      console.info("[alibaba.sync.page]", {
        page: page + 1,
        rawCount: parser.records.length,
        parsedCount: parsedEmails,
        added: batchSummary.addedToSuppression,
        alreadySuppressed: batchSummary.alreadySuppressed,
        hasNextStart: Boolean(extractedNextStart)
      });

      if (!extractedNextStart) {
        await prisma.alibabaSuppressionSyncState.update({
          where: { id: syncStateId },
          data: { lockOwner: null, lockedAt: null, stopRequested: false }
        });
        return;
      }
      await sleep(LOOP_DELAY_MS);
    }

    const latest = await prisma.alibabaSuppressionSyncState.findUnique({ where: { id: syncStateId } });
    if (!latest) return;
    if (latest.stopRequested) {
      await markPaused(syncStateId);
      return;
    }
    if (latest.status !== "running" || !latest.nextStart) {
      await prisma.alibabaSuppressionSyncState.update({
        where: { id: syncStateId },
        data: { lockOwner: null, lockedAt: null }
      });
      return;
    }

    if (AUTO_CONTINUE) {
      await alibabaSuppressionSyncQueue.add(
        "alibaba_suppression_sync_auto",
        { syncStateId, trigger: "auto" },
        { jobId: alibabaSyncBullmqJobId("auto", syncStateId) }
      );
    } else {
      await prisma.alibabaSuppressionSyncState.update({
        where: { id: syncStateId },
        data: { status: "paused", lockOwner: null, lockedAt: null, nextRetryAt: null }
      });
      return;
    }
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: syncStateId },
      data: { lockOwner: null, lockedAt: null }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const prismaCode =
      error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    const stateRow = await prisma.alibabaSuppressionSyncState.findUnique({ where: { id: syncStateId } });
    const maxRetries = Math.max(1, Number(stateRow?.maxRetries ?? 10));
    const currentRetryCount = Number(stateRow?.retryCount ?? 0);
    const consecutiveFailures = Number(stateRow?.consecutiveFailures ?? 0);
    const kind = classifyAlibabaSyncError({ message: msg, prismaCode });
    await finalizeFailure(syncStateId, kind, consecutiveFailures, maxRetries, currentRetryCount);
  }
}

/** Boot + periodic: resume stuck Alibaba sync jobs without raw cursor in logs. */
export async function recoverAlibabaSyncJobs() {
  const staleBefore = new Date(Date.now() - 2 * 60_000);
  const now = new Date();

  const bullMqLockFailed = await prisma.alibabaSuppressionSyncState.findMany({
    where: {
      syncType: "query_invalid_address",
      status: "failed",
      NOT: { nextStart: null },
      OR: [
        { lastFailureCode: "BULLMQ_JOB_ID_OR_LOCK" },
        { lastError: { contains: "Custom Id cannot contain", mode: "insensitive" } },
        { lastError: { contains: "could not renew lock", mode: "insensitive" } },
        { lastError: { contains: "Missing key for job", mode: "insensitive" } }
      ]
    },
    select: {
      id: true,
      status: true,
      pagesFetched: true,
      rawRecords: true,
      nextStart: true,
      lastError: true,
      lastFailureCode: true
    }
  });

  const [staleRunning, dueRetrying, nullRetrying, failedCandidates] = await Promise.all([
    prisma.alibabaSuppressionSyncState.findMany({
      where: {
        syncType: "query_invalid_address",
        status: "running",
        updatedAt: { lt: staleBefore }
      },
      select: { id: true, status: true, pagesFetched: true, rawRecords: true, nextStart: true }
    }),
    prisma.alibabaSuppressionSyncState.findMany({
      where: {
        syncType: "query_invalid_address",
        status: "retrying",
        nextRetryAt: { lte: now }
      },
      select: { id: true, status: true, pagesFetched: true, rawRecords: true, nextStart: true }
    }),
    prisma.alibabaSuppressionSyncState.findMany({
      where: {
        syncType: "query_invalid_address",
        status: "retrying",
        nextRetryAt: null
      },
      select: { id: true, status: true, pagesFetched: true, rawRecords: true, nextStart: true }
    }),
    prisma.alibabaSuppressionSyncState.findMany({
      where: { syncType: "query_invalid_address", status: "failed" },
      select: {
        id: true,
        lastFailureCode: true,
        consecutiveFailures: true,
        maxRetries: true,
        retryCount: true,
        pagesFetched: true,
        rawRecords: true,
        nextStart: true,
        status: true
      }
    })
  ]);

  const failedToResume = failedCandidates.filter(
    (row: (typeof failedCandidates)[number]) =>
      isRetryableFailureCode(row.lastFailureCode) &&
      Number(row.consecutiveFailures ?? 0) < Math.max(1, Number(row.maxRetries ?? 10)) &&
      Number(row.retryCount ?? 0) < Math.max(1, Number(row.maxRetries ?? 10))
  );

  const seen = new Set<string>();
  async function enqueueRecovery(row: {
    id: string;
    status: string;
    pagesFetched: number;
    rawRecords: number;
    nextStart: string | null;
  }) {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    await alibabaSuppressionSyncQueue.add(
      "alibaba_suppression_sync_recovery",
      { syncStateId: row.id, trigger: "recovery" },
      { jobId: alibabaSyncBullmqJobId("recovery", row.id) }
    );
    console.info("[alibaba.sync.recovery] resumed", {
      status: row.status,
      pagesFetched: row.pagesFetched,
      rawRecords: row.rawRecords,
      hasNextStart: Boolean(row.nextStart)
    });
  }

  for (const row of bullMqLockFailed) {
    if (seen.has(row.id)) continue;
    if (!row.nextStart?.trim()) continue;
    if (row.lastFailureCode !== "BULLMQ_JOB_ID_OR_LOCK" && !isRecoverableBullmqLockOrJobIdError(row.lastError)) {
      continue;
    }
    seen.add(row.id);
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: row.id },
      data: {
        status: "running",
        lastError: null,
        lastFailureCode: null,
        lastFailureMessage: null,
        lastFailureAt: null,
        lockOwner: null,
        lockedAt: null,
        nextRetryAt: null,
        consecutiveFailures: 0
      }
    });
    await alibabaSuppressionSyncQueue.add(
      "alibaba_suppression_sync_recovery",
      { syncStateId: row.id, trigger: "recovery" },
      { jobId: alibabaSyncBullmqJobId("recovery", row.id) }
    );
    console.info("[alibaba.sync.recovery] resumed", {
      status: "running",
      pagesFetched: row.pagesFetched,
      rawRecords: row.rawRecords,
      hasNextStart: true
    });
  }

  for (const row of staleRunning) await enqueueRecovery(row);
  for (const row of dueRetrying) await enqueueRecovery(row);
  for (const row of nullRetrying) await enqueueRecovery(row);
  for (const row of failedToResume) {
    if (seen.has(row.id)) continue;
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: row.id },
      data: {
        status: "retrying",
        nextRetryAt: new Date(),
        lockOwner: null,
        lockedAt: null
      }
    });
    await enqueueRecovery({ ...row, status: "retrying" });
  }
}

/** @deprecated use recoverAlibabaSyncJobs */
export const resumeStaleAlibabaSyncJobs = recoverAlibabaSyncJobs;
