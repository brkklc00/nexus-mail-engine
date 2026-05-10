import crypto from "node:crypto";
import { prisma } from "@nexus/db";
import { alibabaSuppressionSyncQueue } from "@nexus/queue";

const SYNC_TYPE = "query_invalid_address";
const DEFAULT_META = {
  responseKeys: [] as string[],
  firstRecordKeys: [] as string[],
  parserPathUsed: null as string | null,
  processedNextStartHashes: [] as string[],
  runPagesFetched: 0,
  runRawRecords: 0,
  runParsedEmails: 0,
  runAddedToSuppression: 0,
  runAlreadySuppressed: 0,
  runRemovedFromLists: 0,
  nextStartLength: 0,
  workerJobId: null as string | null,
  batchPages: 0,
  pageSize: 0
};

type SyncStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelling" | "stopped_limit";

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
  runPagesFetched: number;
  runRawRecords: number;
  runParsedEmails: number;
  runAddedToSuppression: number;
  runAlreadySuppressed: number;
  runRemovedFromLists: number;
  hasNextStart: boolean;
  nextStartHash: string | null;
  nextStartLength: number;
  progressPercent: number;
  progressText: string;
  throughputPerMinute: number;
  etaText: string;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  message: string;
  responseKeys: string[];
  firstRecordKeys: string[];
  parserPathUsed: string | null;
  workerJobId: string | null;
  batchPages: number;
  pageSize: number;
};

type StartInput = {
  startTime: string;
  endTime: string;
  removeFromLists: boolean;
};

function hashNextStart(nextStart: string | null): string | null {
  if (!nextStart) return null;
  return crypto.createHash("sha256").update(nextStart).digest("hex").slice(0, 8);
}

function getMeta(raw: unknown) {
  const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ...DEFAULT_META,
    ...base,
    responseKeys: Array.isArray(base.responseKeys) ? (base.responseKeys as string[]) : [],
    firstRecordKeys: Array.isArray(base.firstRecordKeys) ? (base.firstRecordKeys as string[]) : [],
    processedNextStartHashes: Array.isArray(base.processedNextStartHashes)
      ? ((base.processedNextStartHashes as string[]).filter(Boolean).slice(-500))
      : []
  };
}

async function getOrCreateAlibabaSyncState(syncType: string = SYNC_TYPE) {
  const existing = await prisma.alibabaSuppressionSyncState.findFirst({
    where: { syncType },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
  });
  if (existing) {
    return existing;
  }
  try {
    return await prisma.alibabaSuppressionSyncState.create({
      data: {
        syncType,
        status: "idle",
        startTime: "",
        endTime: "",
        meta: DEFAULT_META
      }
    });
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "P2002") {
      const again = await prisma.alibabaSuppressionSyncState.findFirst({
        where: { syncType },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      });
      if (again) {
        return again;
      }
    }
    throw error;
  }
}

async function getOrCreateState() {
  return getOrCreateAlibabaSyncState(SYNC_TYPE);
}

function toPublicStatus(row: any): AlibabaSyncPublicStatus {
  const meta = getMeta(row.meta);
  const totalCount = Number(row.totalCount ?? 0);
  const rawRecords = Number(row.rawRecords ?? 0);
  const progressPercent = totalCount > 0 ? Math.max(0, Math.min(100, (rawRecords / totalCount) * 100)) : 0;
  const startedAt = row.startedAt ? new Date(row.startedAt) : null;
  const elapsedMinutes = startedAt ? Math.max(0.1, (Date.now() - startedAt.getTime()) / 60_000) : 0;
  const throughputPerMinute = elapsedMinutes > 0 ? Number((rawRecords / elapsedMinutes).toFixed(2)) : 0;
  const remaining = Math.max(0, totalCount - rawRecords);
  const etaMinutes = throughputPerMinute > 0 ? remaining / throughputPerMinute : 0;
  const etaText =
    throughputPerMinute <= 0 || remaining <= 0
      ? "-"
      : etaMinutes < 60
        ? `~${Math.ceil(etaMinutes)} dk`
        : `~${Math.ceil(etaMinutes / 60)} saat`;
  return {
    status: row.status as SyncStatus,
    startTime: row.startTime,
    endTime: row.endTime,
    totalCount,
    pagesFetched: Number(row.pagesFetched ?? 0),
    rawRecords,
    parsedEmails: Number(row.parsedEmails ?? 0),
    addedToSuppression: Number(row.addedToSuppression ?? 0),
    alreadySuppressed: Number(row.alreadySuppressed ?? 0),
    removedFromLists: Number(row.removedFromLists ?? 0),
    invalidEmailSkipped: Number(row.invalidEmailSkipped ?? 0),
    ignoredTemporary: Number(row.ignoredTemporary ?? 0),
    ignoredUnknown: Number(row.ignoredUnknown ?? 0),
    runPagesFetched: Number(meta.runPagesFetched ?? 0),
    runRawRecords: Number(meta.runRawRecords ?? 0),
    runParsedEmails: Number(meta.runParsedEmails ?? 0),
    runAddedToSuppression: Number(meta.runAddedToSuppression ?? 0),
    runAlreadySuppressed: Number(meta.runAlreadySuppressed ?? 0),
    runRemovedFromLists: Number(meta.runRemovedFromLists ?? 0),
    hasNextStart: Boolean(row.nextStart),
    nextStartHash: row.nextStartHash ?? null,
    nextStartLength: Number(meta.nextStartLength ?? 0),
    progressPercent,
    progressText: `${rawRecords.toLocaleString("tr-TR")} / ${totalCount.toLocaleString("tr-TR")} işlendi (%${progressPercent.toFixed(2)})`,
    throughputPerMinute,
    etaText,
    lastError: row.lastError ?? null,
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    message:
      row.status === "running"
        ? "Alibaba senkronizasyonu arka planda devam ediyor."
        : row.status === "paused" || row.status === "stopped_limit"
          ? "İşlem duraklatıldı. Devam Ettir ile kaldığı yerden sürdürebilirsiniz."
          : row.status === "completed"
            ? "Senkronizasyon tamamlandı."
            : row.lastError ?? "Hazır",
    responseKeys: meta.responseKeys,
    firstRecordKeys: meta.firstRecordKeys,
    parserPathUsed: typeof meta.parserPathUsed === "string" ? meta.parserPathUsed : null,
    workerJobId: typeof meta.workerJobId === "string" ? meta.workerJobId : null,
    batchPages: Number(meta.batchPages ?? 0),
    pageSize: Number(meta.pageSize ?? 0)
  };
}

async function enqueueSyncJob(syncStateId: string, trigger: "start" | "resume" | "auto" | "recovery") {
  const job = await alibabaSuppressionSyncQueue.add(
    "alibaba_suppression_sync",
    { syncStateId, trigger },
    { jobId: `alibaba-sync:${syncStateId}:${Date.now()}` }
  );
  const state = await getOrCreateState();
  const meta = getMeta(state.meta);
  await prisma.alibabaSuppressionSyncState.update({
    where: { id: state.id },
    data: {
      meta: {
        ...meta,
        workerJobId: String((job as any)?.id ?? ""),
        batchPages: Math.max(1, Number(process.env.ALIBABA_SYNC_BATCH_PAGES ?? 200)),
        pageSize: Math.max(1, Number(process.env.ALIBABA_SYNC_PAGE_SIZE ?? 100))
      }
    }
  });
}

export async function getAlibabaSyncStatus(): Promise<AlibabaSyncPublicStatus> {
  const state = await getOrCreateState();
  return toPublicStatus(state);
}

export async function startAlibabaBackgroundSync(input: StartInput): Promise<AlibabaSyncPublicStatus> {
  const current = await getOrCreateState();
  if (current.status === "running" || current.status === "cancelling") {
    return toPublicStatus(current);
  }
  const startedAt = new Date();
  await prisma.alibabaSuppressionSyncState.update({
    where: { id: current.id },
    data: {
      status: "running",
      startTime: input.startTime,
      endTime: input.endTime,
      nextStart: null,
      nextStartHash: null,
      stopRequested: false,
      removeFromLists: input.removeFromLists,
      lockedAt: null,
      lockOwner: null,
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
      startedAt,
      completedAt: null,
      meta: {
        ...DEFAULT_META,
        nextStartLength: 0,
        processedNextStartHashes: []
      }
    }
  });
  await enqueueSyncJob(current.id, "start");
  return getAlibabaSyncStatus();
}

export async function pauseAlibabaSync(): Promise<AlibabaSyncPublicStatus> {
  const state = await getOrCreateState();
  if (state.status === "running") {
    await prisma.alibabaSuppressionSyncState.update({
      where: { id: state.id },
      data: { stopRequested: true, status: "cancelling" }
    });
  }
  return getAlibabaSyncStatus();
}

export async function resumeAlibabaSync(): Promise<AlibabaSyncPublicStatus> {
  const state = await getOrCreateState();
  if (state.status === "running" || state.status === "cancelling") {
    return toPublicStatus(state);
  }
  if (!state.nextStart && Number(state.rawRecords ?? 0) > 0 && Number(state.totalCount ?? 0) > Number(state.rawRecords ?? 0)) {
    throw new Error("Kaldığı yer bilgisi bulunamadı. Lütfen senkronizasyonu sıfırlayıp yeniden başlatın.");
  }
  await prisma.alibabaSuppressionSyncState.update({
    where: { id: state.id },
    data: { status: "running", stopRequested: false, lastError: null, completedAt: null }
  });
  await enqueueSyncJob(state.id, "resume");
  return getAlibabaSyncStatus();
}

export async function resetAlibabaSyncState() {
  const state = await getOrCreateState();
  await prisma.alibabaSuppressionSyncState.update({
    where: { id: state.id },
    data: {
      status: "idle",
      startTime: "",
      endTime: "",
      nextStart: null,
      nextStartHash: null,
      stopRequested: false,
      lockedAt: null,
      lockOwner: null,
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
      completedAt: null,
      meta: DEFAULT_META
    }
  });
  return getAlibabaSyncStatus();
}
