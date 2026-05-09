import { prisma } from "@nexus/db";
import { deliveryQueue, safeJobId } from "@nexus/queue";

function idempotencyKey(campaignId: string, recipientId: string, templateVersion: number): string {
  return `${campaignId}:${recipientId}:${templateVersion}`;
}

export async function recoverCampaignQueuesOnBoot() {
  const staleThreshold = new Date(Date.now() - 10 * 60_000);
  const campaigns = await prisma.campaign.findMany({
    where: {
      isDeleted: false,
      status: { in: ["running", "queued", "partially_completed"] }
    },
    select: {
      id: true,
      templateId: true,
      template: { select: { version: true } }
    }
  });
  const campaignIds = campaigns.map((item: { id: string }) => item.id);
  if (campaignIds.length === 0) {
    console.info("[worker.recovery] campaigns resumed", {
      activeCampaigns: 0,
      pendingRecipients: 0,
      queuedRecipients: 0,
      redisWaiting: 0,
      rebuiltJobs: 0
    });
    return;
  }

  const [pendingRecipients, queuedRecipients, queueCounts] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where: {
        campaignId: { in: campaignIds },
        sendStatus: "pending"
      },
      select: {
        campaignId: true,
        recipientId: true,
        smtpAccountId: true
      },
      orderBy: [{ createdAt: "asc" }],
      take: 50000
    }),
    prisma.campaignRecipient.findMany({
      where: {
        campaignId: { in: campaignIds },
        sendStatus: "queued"
      },
      orderBy: [{ updatedAt: "asc" }],
      select: {
        campaignId: true,
        recipientId: true,
        smtpAccountId: true,
        updatedAt: true
      },
      take: 50000
    }),
    deliveryQueue.getJobCounts().catch(() => ({ waiting: 0, wait: 0, active: 0 } as any))
  ]);

  const campaignTemplateVersion = new Map<string, number>(
    campaigns.map((item: { id: string; template: { version: number } }) => [item.id, Number(item.template.version ?? 1)])
  );
  const redisWaiting = Number(queueCounts.waiting ?? (queueCounts as any).wait ?? 0);

  const existingJobs = await deliveryQueue
    .getJobs(["waiting", "active", "delayed", "prioritized"], 0, 100_000, true)
    .catch(() => [] as Array<{ id?: string | number; timestamp?: number }>);
  const existingJobIds = new Set(existingJobs.map((job: any) => String(job?.id ?? "")).filter(Boolean));
  const staleQueuedRows = queuedRecipients.filter((row: { updatedAt: Date }) => row.updatedAt < staleThreshold);
  const staleQueuedToPending: Array<{ campaignId: string; recipientId: string }> = [];
  for (const row of staleQueuedRows) {
    const version = Number(campaignTemplateVersion.get(row.campaignId) ?? 1);
    const jobId = safeJobId(`delivery_${row.campaignId}_${row.recipientId}_${version}`);
    if (!existingJobIds.has(jobId)) {
      staleQueuedToPending.push({ campaignId: row.campaignId, recipientId: row.recipientId });
    }
  }
  for (const row of staleQueuedToPending) {
    await prisma.campaignRecipient.updateMany({
      where: {
        campaignId: row.campaignId,
        recipientId: row.recipientId,
        sendStatus: "queued"
      },
      data: { sendStatus: "pending" }
    });
  }

  const rebuiltSet = new Set<string>();
  const rebuildRows = [
    ...pendingRecipients.map((row: { campaignId: string; recipientId: string; smtpAccountId: string | null }) => ({ ...row, source: "pending" as const })),
    ...queuedRecipients.map((row: { campaignId: string; recipientId: string; smtpAccountId: string | null }) => ({ campaignId: row.campaignId, recipientId: row.recipientId, smtpAccountId: row.smtpAccountId, source: "queued" as const }))
  ];

  for (const row of rebuildRows) {
    const version = Number(campaignTemplateVersion.get(row.campaignId) ?? 1);
    const jobId = safeJobId(`delivery_${row.campaignId}_${row.recipientId}_${version}`);
    await deliveryQueue.add(
      "deliver_recovery",
      {
        campaignId: row.campaignId,
        recipientId: row.recipientId,
        templateId: "",
        smtpAccountId: row.smtpAccountId ?? "",
        idempotencyKey: idempotencyKey(row.campaignId, row.recipientId, version),
        attempt: 1
      },
      {
        jobId
      }
    );
    rebuiltSet.add(jobId);
  }

  console.info("[worker.recovery]", {
    activeCampaigns: campaigns.length,
    pendingRecipients: pendingRecipients.length,
    queuedRecipients: queuedRecipients.length,
    redisWaiting,
    rebuiltJobs: rebuiltSet.size
  });
}
