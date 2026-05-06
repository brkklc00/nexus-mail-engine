import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { campaignQueue, deadLetterQueue, deliveryQueue, retryQueue } from "@nexus/queue";
import { getSession } from "@/server/auth/session";

const ACTIVE_CAMPAIGN_STATUSES = new Set(["running", "queued", "processing", "sending", "paused", "pending"]);
const STALE_CAMPAIGN_STATUSES = new Set(["canceled", "completed", "failed", "partially_completed"]);
const SCAN_BATCH_SIZE = 500;
const MAX_SCAN_PER_QUEUE = 20000;
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
      const end = Math.min(start + SCAN_BATCH_SIZE - 1, MAX_SCAN_PER_QUEUE - 1);
      const jobs = (await queue.getJobs([state], start, end, true)) as any[];
      if (!jobs.length) break;
      all.push(...jobs);
      if (jobs.length < SCAN_BATCH_SIZE) break;
      start += SCAN_BATCH_SIZE;
    }
  }
  return all;
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
  let cleaned = 0;
  let skippedActive = 0;
  let skippedUnknown = 0;
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
      cleaned = deliveryIds.length + retryIds.length + deadIds.length;
    } else if (action === "clean_completed") {
      const [deliveryIds, retryIds, deadIds, campaignIds] = await Promise.all([
        queues.deliveryQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed"),
        queues.retryQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed"),
        queues.deadQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed"),
        queues.campaignQueue.clean(COMPLETED_CLEAN_AGE_MS, 5000, "completed")
      ]);
      cleaned = deliveryIds.length + retryIds.length + deadIds.length + campaignIds.length;
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
          cleaned += 1;
        } catch {
          skippedUnknown += 1;
        }
      }
    } else if (action === "clean_stale_campaign_jobs") {
      const jobs = [
        ...(await collectJobs(queues.campaignQueue, ["waiting", "delayed", "prioritized"])),
        ...(await collectJobs(queues.deliveryQueue, ["waiting", "delayed", "prioritized"])),
        ...(await collectJobs(queues.retryQueue, ["waiting", "delayed", "prioritized"]))
      ];
      const campaignIds = Array.from(
        new Set(jobs.map((job) => (job as any)?.data?.campaignId).filter((id): id is string => typeof id === "string" && id.length > 0))
      );
      const campaigns = campaignIds.length
        ? await prisma.campaign.findMany({
            where: { id: { in: campaignIds } },
            select: { id: true, status: true, isDeleted: true, deletedAt: true }
          })
        : [];
      const campaignMap = new Map<string, CampaignLookup>(
        campaigns.map((campaign: CampaignLookup) => [campaign.id, campaign])
      );

      for (const job of jobs) {
        const jobCampaignId = (job as any)?.data?.campaignId;
        if (!jobCampaignId || typeof jobCampaignId !== "string") {
          skippedUnknown += 1;
          continue;
        }
        const campaign = campaignMap.get(jobCampaignId);
        if (!campaign) {
          skippedUnknown += 1;
          continue;
        }

        const isActive = ACTIVE_CAMPAIGN_STATUSES.has(campaign.status);
        const isSoftDeleted = campaign.isDeleted || Boolean(campaign.deletedAt);
        const isStale = STALE_CAMPAIGN_STATUSES.has(campaign.status) || isSoftDeleted;

        if (isActive && !isSoftDeleted && !isStale) {
          skippedActive += 1;
          protectedActiveCampaigns.add(campaign.id);
          continue;
        }
        if (!isStale) {
          skippedUnknown += 1;
          continue;
        }
        if (typeof (job as any)?.remove !== "function") {
          skippedUnknown += 1;
          continue;
        }
        try {
          await (job as any).remove();
          cleaned += 1;
        } catch {
          skippedUnknown += 1;
        }
      }
    } else {
      return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
    }

    const queueCounts = await getQueueCounts(queues);
    console.info("[queue.admin] cleaned", cleaned);
    console.info("[queue.admin] skipped active", skippedActive);
    console.info("[queue.admin] skipped unknown", skippedUnknown);

    return NextResponse.json({
      ok: true,
      action,
      cleaned,
      skippedActive,
      skippedUnknown,
      protectedActiveCampaigns: Array.from(protectedActiveCampaigns),
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
