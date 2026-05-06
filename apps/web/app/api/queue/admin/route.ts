import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { campaignQueue, deadLetterQueue, deliveryQueue, retryQueue } from "@nexus/queue";
import { getSession } from "@/server/auth/session";

const ACTIVE_CAMPAIGN_STATUSES = new Set(["running", "queued", "processing", "sending", "paused", "pending"]);
const STALE_CAMPAIGN_STATUSES = new Set(["canceled", "completed", "failed", "partially_completed", "deleted"]);
const JOB_SCAN_CHUNK_SIZE = 2000;
const CAMPAIGN_LOOKUP_CHUNK_SIZE = 2000;
const REMOVE_CONCURRENCY = 4;
const MAX_SCAN_PER_QUEUE = 1_500_000;
const FAILED_CLEAN_AGE_MS = 24 * 60 * 60 * 1000;
const COMPLETED_CLEAN_AGE_MS = 60 * 60 * 1000;

type AdminAction =
  | "pause"
  | "resume"
  | "clean_stale_campaign_jobs"
  | "clean_failed"
  | "clean_completed"
  | "clean_campaign_jobs";

type CampaignLookup = {
  id: string;
  status: string;
  isDeleted: boolean;
  deletedAt: Date | null;
};

type QueueJobLike = {
  id?: string | number;
  data?: { campaignId?: string };
  remove?: () => Promise<void>;
};

type CleanupProgress = {
  scanned: number;
  cleaned: number;
  skippedActive: number;
  skippedUnknown: number;
};

function createQueues() {
  return {
    campaignQueue,
    deliveryQueue,
    retryQueue,
    deadQueue: deadLetterQueue
  };
}

async function getQueueCounts(queues: ReturnType<typeof createQueues>) {
  const [campaign, delivery, retry, dead] = await Promise.all([
    queues.campaignQueue.getJobCounts(),
    queues.deliveryQueue.getJobCounts(),
    queues.retryQueue.getJobCounts(),
    queues.deadQueue.getJobCounts()
  ]);
  return { campaign, delivery, retry, dead };
}

async function collectJobs(
  queue: {
    getJobs: (types?: any, start?: number, end?: number, asc?: boolean) => Promise<any[]>;
  },
  states: Array<"waiting" | "delayed" | "prioritized">
) {
  const all: any[] = [];
  for (const state of states) {
    let start = 0;
    while (start < MAX_SCAN_PER_QUEUE) {
      const end = Math.min(start + JOB_SCAN_CHUNK_SIZE - 1, MAX_SCAN_PER_QUEUE - 1);
      const jobs = (await queue.getJobs([state], start, end, true)) as any[];
      if (!jobs.length) break;
      all.push(...jobs);
      if (jobs.length < JOB_SCAN_CHUNK_SIZE) break;
      start += JOB_SCAN_CHUNK_SIZE;
    }
  }
  return all;
}

function isStaleCampaign(campaign: CampaignLookup): boolean {
  return STALE_CAMPAIGN_STATUSES.has(campaign.status) || campaign.isDeleted || Boolean(campaign.deletedAt);
}

function isActiveCampaign(campaign: CampaignLookup): boolean {
  return ACTIVE_CAMPAIGN_STATUSES.has(campaign.status) && !campaign.isDeleted && !campaign.deletedAt;
}

async function lookupCampaignsByIds(campaignIds: string[]): Promise<Map<string, CampaignLookup>> {
  const uniqueCampaignIds = Array.from(new Set(campaignIds));
  const campaignMap = new Map<string, CampaignLookup>();
  for (let index = 0; index < uniqueCampaignIds.length; index += CAMPAIGN_LOOKUP_CHUNK_SIZE) {
    const batchIds = uniqueCampaignIds.slice(index, index + CAMPAIGN_LOOKUP_CHUNK_SIZE);
    const campaigns = await prisma.campaign.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, status: true, isDeleted: true, deletedAt: true }
    });
    for (const campaign of campaigns as CampaignLookup[]) {
      campaignMap.set(campaign.id, campaign);
    }
  }
  return campaignMap;
}

async function removeJobsInParallel(
  jobs: QueueJobLike[],
  progress: CleanupProgress
): Promise<void> {
  if (!jobs.length) {
    return;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(REMOVE_CONCURRENCY, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const current = cursor;
      cursor += 1;
      const job = jobs[current];
      if (typeof job.remove !== "function") {
        progress.skippedUnknown += 1;
        continue;
      }
      try {
        await job.remove();
        progress.cleaned += 1;
      } catch {
        progress.skippedUnknown += 1;
      }
    }
  });

  await Promise.all(workers);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: AdminAction; campaignId?: string };
  const action = body.action;
  const campaignId = body.campaignId?.trim();

  if (!action) {
    return NextResponse.json({ ok: false, error: "action_required" }, { status: 400 });
  }

  const queues = createQueues();
  const progress: CleanupProgress = {
    scanned: 0,
    cleaned: 0,
    skippedActive: 0,
    skippedUnknown: 0
  };
  const protectedActiveCampaigns = new Set<string>();

  try {
    console.info("[queue.admin] cleanup started", { action, campaignId: campaignId ?? null });

    if (action === "pause") {
      await Promise.all([queues.campaignQueue.pause(), queues.deliveryQueue.pause(), queues.retryQueue.pause()]);
    } else if (action === "resume") {
      await Promise.all([queues.campaignQueue.resume(), queues.deliveryQueue.resume(), queues.retryQueue.resume()]);
    } else if (action === "clean_failed") {
      const [deliveryIds, retryIds, deadIds] = await Promise.all([
        queues.deliveryQueue.clean(FAILED_CLEAN_AGE_MS, 5000, "failed"),
        queues.retryQueue.clean(FAILED_CLEAN_AGE_MS, 5000, "failed"),
        queues.deadQueue.clean(FAILED_CLEAN_AGE_MS, 5000, "failed")
      ]);
      progress.cleaned = deliveryIds.length + retryIds.length + deadIds.length;
    } else if (action === "clean_completed") {
      const [deliveryIds, retryIds, deadIds, campaignIds] = await Promise.all([
        queues.deliveryQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed"),
        queues.retryQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed"),
        queues.deadQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed"),
        queues.campaignQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed")
      ]);
      progress.cleaned = deliveryIds.length + retryIds.length + deadIds.length + campaignIds.length;
    } else if (action === "clean_campaign_jobs") {
      if (!campaignId) {
        return NextResponse.json({ ok: false, error: "campaign_id_required" }, { status: 400 });
      }
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, status: true, isDeleted: true, deletedAt: true }
      });
      if (!campaign) {
        return NextResponse.json({ ok: false, error: "campaign_not_found" }, { status: 404 });
      }
      const isActive = ACTIVE_CAMPAIGN_STATUSES.has(campaign.status);
      const isSoftDeleted = campaign.isDeleted || Boolean(campaign.deletedAt);
      const isStale = STALE_CAMPAIGN_STATUSES.has(campaign.status) || isSoftDeleted;
      if (isActive && !isSoftDeleted && !isStale) {
        return NextResponse.json(
          {
            ok: false,
            code: "active_campaign_queue_protected",
            error: "Bu kampanya aktif olduğu için kuyruğu temizlenemez. Önce kampanyayı durdurun veya iptal edin."
          },
          { status: 409 }
        );
      }
      const jobs = [
        ...(await collectJobs(queues.campaignQueue, ["waiting", "delayed", "prioritized"])),
        ...(await collectJobs(queues.deliveryQueue, ["waiting", "delayed", "prioritized"])),
        ...(await collectJobs(queues.retryQueue, ["waiting", "delayed", "prioritized"]))
      ];
      for (const job of jobs) {
        if ((job as any)?.data?.campaignId !== campaignId) continue;
        if (typeof (job as any)?.remove !== "function") continue;
        try {
          await (job as any).remove();
          progress.cleaned += 1;
        } catch {
          progress.skippedUnknown += 1;
        }
      }
    } else if (action === "clean_stale_campaign_jobs") {
      const queueTargets = [queues.campaignQueue, queues.deliveryQueue, queues.retryQueue];
      const states: Array<"waiting" | "delayed" | "prioritized"> = ["waiting", "delayed", "prioritized"];

      for (const targetQueue of queueTargets) {
        for (const state of states) {
          for (let start = 0; start < MAX_SCAN_PER_QUEUE; start += JOB_SCAN_CHUNK_SIZE) {
            const end = Math.min(start + JOB_SCAN_CHUNK_SIZE - 1, MAX_SCAN_PER_QUEUE - 1);
            const jobs = (await targetQueue.getJobs([state], start, end, true)) as QueueJobLike[];
            if (!jobs.length) {
              break;
            }
            progress.scanned += jobs.length;

            const batchCampaignIds = jobs
              .map((job) => job.data?.campaignId)
              .filter((id): id is string => typeof id === "string" && id.length > 0);
            const campaignMap = await lookupCampaignsByIds(batchCampaignIds);
            const removableJobs: QueueJobLike[] = [];

            for (const job of jobs) {
              const jobCampaignId = job.data?.campaignId;
              if (!jobCampaignId || typeof jobCampaignId !== "string") {
                progress.skippedUnknown += 1;
                continue;
              }

              const campaign = campaignMap.get(jobCampaignId);
              if (!campaign) {
                progress.skippedUnknown += 1;
                continue;
              }

              if (isActiveCampaign(campaign)) {
                progress.skippedActive += 1;
                protectedActiveCampaigns.add(campaign.id);
                continue;
              }

              if (!isStaleCampaign(campaign)) {
                progress.skippedUnknown += 1;
                continue;
              }

              removableJobs.push(job);
            }

            await removeJobsInParallel(removableJobs, progress);

            console.info("[queue.admin] stale cleanup batch", {
              state,
              scanned: progress.scanned,
              cleaned: progress.cleaned,
              skippedActive: progress.skippedActive,
              skippedUnknown: progress.skippedUnknown
            });

            if (jobs.length < JOB_SCAN_CHUNK_SIZE) {
              break;
            }
          }
        }
      }
    } else {
      return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
    }

    const queueCounts = await getQueueCounts(queues);
    const remaining =
      Number(queueCounts.campaign.waiting ?? 0) +
      Number(queueCounts.campaign.delayed ?? 0) +
      Number(queueCounts.campaign.prioritized ?? 0) +
      Number(queueCounts.delivery.waiting ?? 0) +
      Number(queueCounts.delivery.delayed ?? 0) +
      Number(queueCounts.delivery.prioritized ?? 0) +
      Number(queueCounts.retry.waiting ?? 0) +
      Number(queueCounts.retry.delayed ?? 0) +
      Number(queueCounts.retry.prioritized ?? 0);
    console.info("[queue.admin] cleaned", progress.cleaned);
    console.info("[queue.admin] skipped active", progress.skippedActive);
    console.info("[queue.admin] skipped unknown", progress.skippedUnknown);

    return NextResponse.json({
      ok: true,
      action,
      scanned: progress.scanned,
      cleaned: progress.cleaned,
      skippedActive: progress.skippedActive,
      skippedUnknown: progress.skippedUnknown,
      remaining,
      protectedActiveCampaigns: Array.from(protectedActiveCampaigns),
      progress: {
        scanned: progress.scanned,
        cleaned: progress.cleaned,
        skippedActive: progress.skippedActive,
        skippedUnknown: progress.skippedUnknown,
        remaining
      },
      queueCounts
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "queue_admin_failed"
      },
      { status: 500 }
    );
  }
}
