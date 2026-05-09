import crypto from "node:crypto";
import { prisma } from "@nexus/db";
import { runSmtpTest, type SmtpErrorCode, type SmtpTestType, updateSmtpHealthSafe } from "@/server/smtp/tester";

type BulkScope = "all_active" | "healthy" | "throttled" | "error" | "selected" | "filtered";

export type BulkTestInput = {
  scope: BulkScope;
  ids?: string[];
  filters?: {
    search?: string;
    status?: string;
    provider?: string;
  };
  testType: SmtpTestType;
  testRecipient?: string;
  concurrency: number;
  timeoutSeconds: number;
  updateHealth: boolean;
  clearThrottleOnSuccess: boolean;
  onlyActive: boolean;
};

type BulkResultItem = {
  smtpId: string;
  fromEmail: string;
  provider: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  latencyMs?: number;
  testedAt: string;
  testType: SmtpTestType;
};

type JobState = {
  jobId: string;
  status: "running" | "completed" | "failed";
  total: number;
  queuedOrProcessed: number;
  summary: { success: number; failed: number; skipped: number };
  results: BulkResultItem[];
  createdAt: string;
  updatedAt: string;
  error?: string;
};

const JOB_TTL_MS = 60 * 60 * 1000;
const jobs = new Map<string, JobState>();

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, state] of jobs.entries()) {
    if (now - new Date(state.updatedAt).getTime() > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

function getErrorCodeForHealth(error?: string): SmtpErrorCode {
  if (!error) return "unknown_error";
  if (error === "auth_failed") return "auth_failed";
  if (error === "timeout") return "timeout";
  if (error === "connection_refused") return "connection_refused";
  if (error === "tls_error") return "tls_error";
  if (error === "provider_rate_limit") return "provider_rate_limit";
  if (error === "missing_configuration") return "missing_configuration";
  return "unknown_error";
}

async function updateHealthByResult(input: {
  smtpId: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  updateHealth: boolean;
  clearThrottleOnSuccess: boolean;
}) {
  if (!input.updateHealth || input.status === "skipped") return;
  const now = new Date();
  if (input.status === "success") {
    await updateSmtpHealthSafe(input.smtpId, {
      healthStatus: "healthy",
      lastError: null,
      lastTestAt: now,
      ...(input.clearThrottleOnSuccess
        ? {
            isThrottled: false,
            throttleReason: null,
            cooldownUntil: null
          }
        : {})
    });
    return;
  }
  const code = getErrorCodeForHealth(input.error);
  if (code === "provider_rate_limit") {
    await updateSmtpHealthSafe(input.smtpId, {
      healthStatus: "warning",
      lastError: code,
      lastTestAt: now,
      isThrottled: true,
      throttleReason: "provider_rate_limit",
      cooldownUntil: new Date(Date.now() + 5 * 60_000)
    });
    return;
  }
  await updateSmtpHealthSafe(input.smtpId, {
    healthStatus: "error",
    lastError: code,
    lastTestAt: now
  });
}

async function resolveScopeRows(input: BulkTestInput) {
  const search = (input.filters?.search ?? "").trim();
  const provider = (input.filters?.provider ?? "").trim();
  const status = (input.filters?.status ?? "").trim();
  const selected = Array.from(new Set((input.ids ?? []).map((id) => String(id).trim()).filter(Boolean)));

  const baseWhere: any = {
    isSoftDeleted: false,
    ...(input.onlyActive ? { isActive: true } : {})
  };
  if (search) {
    baseWhere.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { fromEmail: { contains: search, mode: "insensitive" } },
      { host: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } }
    ];
  }
  if (provider && provider !== "all") {
    baseWhere.providerLabel = { equals: provider, mode: "insensitive" };
  }

  if (input.scope === "selected") {
    if (selected.length === 0) return [];
    baseWhere.id = { in: selected };
  } else if (input.scope === "healthy") {
    baseWhere.healthStatus = "healthy";
    baseWhere.isThrottled = false;
  } else if (input.scope === "throttled") {
    baseWhere.isThrottled = true;
  } else if (input.scope === "error") {
    baseWhere.OR = [...(baseWhere.OR ?? []), { healthStatus: "error" }, { lastError: { not: null } }];
  } else if (input.scope === "filtered") {
    if (status === "healthy") {
      baseWhere.healthStatus = "healthy";
      baseWhere.isThrottled = false;
    } else if (status === "throttled") {
      baseWhere.isThrottled = true;
    } else if (status === "error") {
      baseWhere.OR = [...(baseWhere.OR ?? []), { healthStatus: "error" }, { lastError: { not: null } }];
    } else if (status === "passive") {
      baseWhere.isActive = false;
    }
  } else if (input.scope === "all_active") {
    baseWhere.isActive = true;
  }

  const rows = await prisma.smtpAccount.findMany({
    where: baseWhere,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      encryption: true,
      username: true,
      passwordEncrypted: true,
      fromEmail: true,
      fromName: true,
      providerLabel: true,
      isActive: true
    }
  });
  return rows;
}

async function runJob(jobId: string, input: BulkTestInput) {
  const jobState = jobs.get(jobId);
  if (!jobState) return;
  const state: JobState = jobState;
  try {
    const rows = await resolveScopeRows(input);
    state.total = rows.length;
    state.updatedAt = new Date().toISOString();
    const concurrency = Math.max(1, Math.min(20, Number(input.concurrency || 5)));
    let cursor = 0;
    let lastSendTestAt = 0;

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= rows.length) break;
        const smtp = rows[index];
        const testedAt = new Date().toISOString();
        if (input.onlyActive && !smtp.isActive) {
          const skipped: BulkResultItem = {
            smtpId: smtp.id,
            fromEmail: smtp.fromEmail,
            provider: smtp.providerLabel ?? "-",
            status: "skipped",
            error: "inactive",
            testedAt,
            testType: input.testType
          };
          state.results.push(skipped);
          state.summary.skipped += 1;
          state.queuedOrProcessed += 1;
          state.updatedAt = new Date().toISOString();
          continue;
        }
        if ((input.testType === "send_test_email" || input.testType === "both") && input.testRecipient) {
          const now = Date.now();
          const waitMs = Math.max(0, 150 - (now - lastSendTestAt));
          if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
          lastSendTestAt = Date.now();
        }
        const result = await runSmtpTest({
          smtp,
          testType: input.testType,
          testRecipient: input.testRecipient,
          timeoutSeconds: input.timeoutSeconds
        });
        const row: BulkResultItem = {
          smtpId: smtp.id,
          fromEmail: smtp.fromEmail,
          provider: smtp.providerLabel ?? "-",
          status: result.ok ? "success" : "failed",
          latencyMs: result.latencyMs,
          error: result.ok ? undefined : result.errorMessage,
          testedAt,
          testType: input.testType
        };
        state.results.push(row);
        if (row.status === "success") state.summary.success += 1;
        else state.summary.failed += 1;
        state.queuedOrProcessed += 1;
        state.updatedAt = new Date().toISOString();
        await updateHealthByResult({
          smtpId: smtp.id,
          status: row.status,
          error: row.error,
          updateHealth: input.updateHealth,
          clearThrottleOnSuccess: input.clearThrottleOnSuccess
        });
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, rows.length)) }, () => worker()));
    state.status = "completed";
    state.updatedAt = new Date().toISOString();
  } catch (error) {
    state.status = "failed";
    state.error = error instanceof Error ? error.message : "bulk_test_failed";
    state.updatedAt = new Date().toISOString();
  }
}

export async function createBulkSmtpTestJob(input: BulkTestInput) {
  cleanupOldJobs();
  const jobId = crypto.randomUUID();
  const initial: JobState = {
    jobId,
    status: "running",
    total: 0,
    queuedOrProcessed: 0,
    summary: { success: 0, failed: 0, skipped: 0 },
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jobs.set(jobId, initial);
  void runJob(jobId, input);
  return { jobId };
}

export function getBulkSmtpTestJob(jobId: string) {
  cleanupOldJobs();
  return jobs.get(jobId) ?? null;
}
