import crypto from "node:crypto";
import type { Job } from "bullmq";
import { prisma } from "@nexus/db";
import { alibabaSuppressionSyncQueue, type AlibabaSuppressionSyncJob } from "@nexus/queue";

type SyncStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelling" | "stopped_limit";

const PAGE_SIZE = Math.max(1, Number(process.env.ALIBABA_SYNC_PAGE_SIZE ?? 100));
const BATCH_PAGES = Math.max(1, Number(process.env.ALIBABA_SYNC_BATCH_PAGES ?? 200));
const LOOP_DELAY_MS = Math.max(0, Number(process.env.ALIBABA_SYNC_LOOP_DELAY_MS ?? 50));
const DB_CHUNK_SIZE = Math.max(100, Number(process.env.ALIBABA_SYNC_DB_CHUNK_SIZE ?? 5000));
const REMOVE_CHUNK_SIZE = Math.max(100, Number(process.env.ALIBABA_SYNC_REMOVE_CHUNK_SIZE ?? 5000));
const MAX_RUNTIME_MS = Math.max(0, Number(process.env.ALIBABA_SYNC_MAX_RUNTIME_MS ?? 0));
const AUTO_CONTINUE = String(process.env.ALIBABA_SYNC_AUTO_CONTINUE ?? "true").toLowerCase() !== "false";

type Candidate = { email: string; emailNormalized: string };

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
    nextStartLength: Number(obj.nextStartLength ?? 0)
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
    process.env.ALIBABA_DM_REGION ??
    process.env.ALIBABA_REGION ??
    process.env.ALIYUN_REGION;
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

async function applySuppressionBatch(candidates: Candidate[], removeFromLists: boolean) {
  if (candidates.length === 0) {
    return { addedToSuppression: 0, alreadySuppressed: 0, removedFromLists: 0 };
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
  if (removeFromLists) {
    for (const emailChunk of chunk(candidates.map((item) => item.emailNormalized), REMOVE_CHUNK_SIZE)) {
      const recipients = await prisma.recipient.findMany({
        where: { emailNormalized: { in: emailChunk } },
        select: { id: true }
      });
      if (recipients.length === 0) continue;
      for (const recipientChunk of chunk(recipients.map((row: { id: string }) => row.id), REMOVE_CHUNK_SIZE)) {
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

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function markPaused(syncStateId: string) {
  await prisma.alibabaSuppressionSyncState.update({
    where: { id: syncStateId },
    data: { status: "paused", stopRequested: false, lockOwner: null, lockedAt: null }
  });
}

export async function processAlibabaSuppressionSync(job: Job<AlibabaSuppressionSyncJob>) {
  const syncStateId = job.data.syncStateId;
  const credentials = resolveCredentials();
  if (!credentials) {
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: syncStateId },
      data: { status: "failed", lastError: "Alibaba kimlik bilgileri bulunamadi.", lockOwner: null, lockedAt: null }
    });
    return;
  }

  const lockOwner = `worker:${process.pid}:${job.id}`;
  const staleThreshold = new Date(Date.now() - 2 * 60_000);
  const lockUpdate = await prisma.alibabaSuppressionSyncState.updateMany({
    where: {
      id: syncStateId,
      OR: [{ lockOwner: null }, { lockedAt: { lt: staleThreshold } }, { lockOwner }]
    },
    data: { lockOwner, lockedAt: new Date(), status: "running" }
  });
  if (lockUpdate.count === 0) return;

  const started = Date.now();
  try {
    for (let page = 0; page < BATCH_PAGES; page += 1) {
      const state = await prisma.alibabaSuppressionSyncState.findUnique({ where: { id: syncStateId } });
      if (!state) return;
      if (state.status !== "running") return;
      if (state.stopRequested) {
        await markPaused(syncStateId);
        return;
      }
      if (MAX_RUNTIME_MS > 0 && Date.now() - started > MAX_RUNTIME_MS) {
        await prisma.alibabaSuppressionSyncState.update({
          where: { id: syncStateId },
          data: { status: "paused", stopRequested: false, lockOwner: null, lockedAt: null }
        });
        return;
      }

      const meta = getMeta(state.meta);
      const url = buildSignedAlibabaUrl(credentials, state.startTime, state.endTime, PAGE_SIZE, state.nextStart);
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) {
        await prisma.alibabaSuppressionSyncState.update({
          where: { id: syncStateId },
          data: {
            status: "failed",
            lastError: payload?.Message ? String(payload.Message) : `Alibaba API hatasi: ${response.status}`,
            lockOwner: null,
            lockedAt: null
          }
        });
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
      const batchSummary = await applySuppressionBatch(pageCandidates, Boolean(state.removeFromLists));
      const extractedNextStart = extractNextStart(payload);
      const extractedHash = hashNextStart(extractedNextStart);
      if (extractedHash && meta.processedNextStartHashes.includes(extractedHash)) {
        await prisma.alibabaSuppressionSyncState.update({
          where: { id: syncStateId },
          data: {
            status: "failed",
            lastError: "Alibaba NextStart tekrarı tespit edildi.",
            lockOwner: null,
            lockedAt: null
          }
        });
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
          completedAt: nextStatus === "completed" ? new Date() : null,
          lockedAt: new Date(),
          meta: {
            ...meta,
            responseKeys,
            firstRecordKeys,
            parserPathUsed,
            processedNextStartHashes,
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

      console.info("[alibaba.sync] page", {
        page: page + 1,
        rawCount: parser.records.length,
        parsedCount: parsedEmails,
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
        { jobId: `alibaba-sync:auto:${syncStateId}:${Date.now()}` }
      );
    } else {
      await prisma.alibabaSuppressionSyncState.update({
        where: { id: syncStateId },
        data: { status: "paused", lockOwner: null, lockedAt: null }
      });
      return;
    }
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: syncStateId },
      data: { lockOwner: null, lockedAt: null }
    });
  } catch (error) {
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: syncStateId },
      data: {
        status: "failed",
        lastError: error instanceof Error ? error.message.slice(0, 400) : "unknown_error",
        lockOwner: null,
        lockedAt: null
      }
    });
  }
}

export async function resumeStaleAlibabaSyncJobs() {
  const stale = await prisma.alibabaSuppressionSyncState.findMany({
    where: {
      syncType: "query_invalid_address",
      status: "running",
      updatedAt: { lt: new Date(Date.now() - 2 * 60_000) }
    },
    select: { id: true }
  });
  for (const item of stale) {
    await alibabaSuppressionSyncQueue.add(
      "alibaba_suppression_sync_recovery",
      { syncStateId: item.id, trigger: "recovery" },
      { jobId: `alibaba-sync:recovery:${item.id}:${Date.now()}` }
    );
    console.info("[alibaba.sync] resuming stale running sync", { syncStateId: item.id });
  }
}
