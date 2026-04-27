import { prisma } from "@nexus/db";
import { campaignQueue, withDistributedLock } from "@nexus/queue";

const CAMPAIGN_LOCK_TTL_MS = 30_000;
const DEFAULT_ROTATE_EVERY = 500;
const DEFAULT_PARALLEL_SMTP = 1;
const DEFAULT_RECIPIENT_CHUNK_SIZE = Number(process.env.CAMPAIGN_START_FETCH_CHUNK_SIZE ?? 1000);
const DEFAULT_INSERT_CHUNK_SIZE = Number(process.env.CAMPAIGN_START_INSERT_CHUNK_SIZE ?? 1000);

async function withCampaignLock<T>(campaignId: string, action: string, callback: () => Promise<T>) {
  return withDistributedLock(`lock:campaign:${action}:${campaignId}`, CAMPAIGN_LOCK_TTL_MS, callback);
}

type SmtpMode = "single" | "pool";
type RotationStrategy = "round_robin" | "rotate_every_n" | "weighted_warmup";

type SmtpPoolConfig = {
  smtpMode: SmtpMode;
  smtpIds: string[];
  parallelSmtpCount: number;
  rotateEvery: number;
  strategy: RotationStrategy;
};

function normalizeChunkSize(input: number, fallback: number): number {
  if (!Number.isFinite(input) || input <= 0) return fallback;
  return Math.max(100, Math.min(5000, Math.floor(input)));
}

function normalizeSmtpConfig(input: {
  smtpMode?: SmtpMode;
  smtpIds?: string[];
  smtpAccountId?: string | null;
  parallelSmtpCount?: number;
  rotateEvery?: number;
  strategy?: RotationStrategy;
}): SmtpPoolConfig {
  const smtpIds = Array.from(new Set([...(input.smtpIds ?? []), ...(input.smtpAccountId ? [input.smtpAccountId] : [])]));
  const smtpMode: SmtpMode = input.smtpMode === "pool" ? "pool" : "single";
  const rotateEvery = Math.max(1, Math.floor(input.rotateEvery ?? DEFAULT_ROTATE_EVERY));
  const parallelSmtpCount = Math.max(1, Math.floor(input.parallelSmtpCount ?? DEFAULT_PARALLEL_SMTP));
  const strategy: RotationStrategy =
    input.strategy === "weighted_warmup" || input.strategy === "round_robin" ? input.strategy : "rotate_every_n";
  return {
    smtpMode,
    smtpIds,
    parallelSmtpCount,
    rotateEvery,
    strategy
  };
}

function buildWeightedPool(
  smtpIds: string[],
  rateBySmtp: Map<string, number>
): string[] {
  const weighted: string[] = [];
  for (const id of smtpIds) {
    const rate = Math.max(0.01, rateBySmtp.get(id) ?? 1);
    const weight = Math.max(1, Math.min(20, Math.round(rate)));
    for (let i = 0; i < weight; i += 1) {
      weighted.push(id);
    }
  }
  return weighted.length > 0 ? weighted : smtpIds;
}

function chooseSmtpForRecipient(
  index: number,
  config: SmtpPoolConfig,
  activeSmtpIds: string[],
  weightedPool: string[]
): string {
  if (activeSmtpIds.length === 1) return activeSmtpIds[0];
  if (config.strategy === "round_robin") {
    return activeSmtpIds[index % activeSmtpIds.length];
  }
  if (config.strategy === "weighted_warmup") {
    return weightedPool[index % weightedPool.length];
  }
  const slot = Math.floor(index / Math.max(1, config.rotateEvery)) % activeSmtpIds.length;
  return activeSmtpIds[slot];
}

export async function createCampaign(input: {
  name: string;
  templateId: string;
  listId?: string | null;
  smtpAccountId?: string | null;
  smtpMode?: SmtpMode;
  smtpIds?: string[];
  parallelSmtpCount?: number;
  rotateEvery?: number;
  strategy?: RotationStrategy;
  scheduledAt?: Date | null;
}) {
  const normalizedConfig = normalizeSmtpConfig({
    smtpMode: input.smtpMode,
    smtpIds: input.smtpIds,
    smtpAccountId: input.smtpAccountId,
    parallelSmtpCount: input.parallelSmtpCount,
    rotateEvery: input.rotateEvery,
    strategy: input.strategy
  });
  const [template, list, smtps] = await Promise.all([
    prisma.mailTemplate.findUnique({ where: { id: input.templateId } }),
    input.listId ? prisma.recipientList.findUnique({ where: { id: input.listId } }) : null,
    prisma.smtpAccount.findMany({
      where: {
        id: { in: normalizedConfig.smtpIds },
        isActive: true,
        isSoftDeleted: false
      },
      orderBy: { createdAt: "asc" }
    })
  ]);

  if (!template) {
    throw new Error("template_not_found");
  }
  if (input.listId && !list) {
    throw new Error("list_not_found");
  }
  if (smtps.length === 0) {
    throw new Error("smtp_pool_empty");
  }
  const primarySmtp = smtps[0];
  const activeSmtpIds = smtps.map((smtp: any) => smtp.id);

  return prisma.campaign.create({
    data: {
      name: input.name,
      subject: template.subject,
      templateId: template.id,
      listId: input.listId ?? null,
      smtpAccountId: primarySmtp.id,
      smtpPoolConfig: {
        smtpMode: normalizedConfig.smtpMode,
        smtpIds: activeSmtpIds,
        parallelSmtpCount: Math.min(normalizedConfig.parallelSmtpCount, activeSmtpIds.length),
        rotateEvery: normalizedConfig.rotateEvery,
        strategy: normalizedConfig.strategy
      },
      provider: primarySmtp.providerLabel ?? "custom-smtp",
      status: input.scheduledAt ? "queued" : "pending",
      scheduledAt: input.scheduledAt ?? null
    }
  });
}

export async function startCampaign(campaignId: string) {
  return withCampaignLock(campaignId, "start", async () => {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        listId: true,
        templateId: true,
        startedAt: true,
        smtpAccountId: true,
        smtpPoolConfig: true
      }
    });
    if (!campaign) {
      throw new Error("campaign_not_found");
    }
    if (!["pending", "queued", "paused"].includes(campaign.status)) {
      throw new Error("campaign_state_invalid");
    }
    if (!campaign.listId) {
      throw new Error("campaign_list_required");
    }

    const poolConfig = normalizeSmtpConfig({
      ...((campaign as any).smtpPoolConfig && typeof (campaign as any).smtpPoolConfig === "object"
        ? ((campaign as any).smtpPoolConfig as any)
        : {}),
      smtpAccountId: campaign.smtpAccountId
    });
    const configuredIds =
      poolConfig.smtpIds.length > 0 ? poolConfig.smtpIds : [campaign.smtpAccountId];

    const smtps = await prisma.smtpAccount.findMany({
      where: { id: { in: configuredIds }, isActive: true, isSoftDeleted: false },
      select: { id: true, targetRatePerSecond: true, maxRatePerSecond: true },
      orderBy: { createdAt: "asc" }
    });
    if (smtps.length === 0) {
      throw new Error("smtp_pool_empty");
    }

    const sortedSmtpIds = configuredIds.filter((id) => smtps.some((smtp: any) => smtp.id === id));
    const activeSmtpIds = sortedSmtpIds.slice(0, Math.max(1, Math.min(poolConfig.parallelSmtpCount, sortedSmtpIds.length)));
    const rateBySmtp = new Map<string, number>(
      smtps.map((smtp: any) => [smtp.id as string, Number(smtp.maxRatePerSecond ?? smtp.targetRatePerSecond ?? 1)])
    );
    const weightedPool = buildWeightedPool(activeSmtpIds, rateBySmtp);
    const fetchChunkSize = normalizeChunkSize(DEFAULT_RECIPIENT_CHUNK_SIZE, 1000);
    const insertChunkSize = normalizeChunkSize(DEFAULT_INSERT_CHUNK_SIZE, 1000);

    await prisma.$transaction([
      prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: "queued",
          startedAt: campaign.startedAt ?? new Date(),
          smtpPoolConfig: {
            smtpMode: poolConfig.smtpMode,
            smtpIds: sortedSmtpIds,
            parallelSmtpCount: activeSmtpIds.length,
            rotateEvery: poolConfig.rotateEvery,
            strategy: poolConfig.strategy
          }
        }
      }),
      prisma.campaignLog.create({
        data: {
          campaignId: campaign.id,
          eventType: "campaign_starting",
          status: "success",
          message: `Campaign start queued. chunk=${insertChunkSize} activeSmtp=${activeSmtpIds.length} strategy=${poolConfig.strategy}`
        }
      })
    ]);

    let cursor: string | null = null;
    let scanned = 0;
    let activeCandidates = 0;
    let suppressedSkipped = 0;
    let inserted = 0;
    let chunkIndex = 0;

    try {
      while (true) {
        const memberships: Array<{
          id: string;
          recipient: { id: string; status: string; emailNormalized: string };
        }> = (await prisma.recipientListMembership.findMany({
          where: { listId: campaign.listId },
          orderBy: { id: "asc" },
          take: fetchChunkSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            recipient: {
              select: { id: true, status: true, emailNormalized: true }
            }
          }
        })) as any;
        if (memberships.length === 0) {
          break;
        }
        cursor = memberships[memberships.length - 1].id;
        scanned += memberships.length;
        chunkIndex += 1;

        const activeRecipients = memberships
          .map((item: any) => item.recipient)
          .filter((recipient: any) => recipient?.status === "active");
        activeCandidates += activeRecipients.length;
        const emails = Array.from(new Set(activeRecipients.map((recipient: any) => recipient.emailNormalized)));
        const suppressedRows = emails.length
          ? await prisma.suppressionEntry.findMany({
              where: { scope: "global", emailNormalized: { in: emails } },
              select: { emailNormalized: true }
            })
          : [];
        const suppressed = new Set(suppressedRows.map((row: any) => row.emailNormalized));
        const candidates = activeRecipients.filter((recipient: any) => !suppressed.has(recipient.emailNormalized));
        suppressedSkipped += activeRecipients.length - candidates.length;

        const dataRows = candidates.map((recipient: any, idx: number) => {
          const smtpAccountId = chooseSmtpForRecipient(inserted + idx, poolConfig, activeSmtpIds, weightedPool);
          return {
            campaignId: campaign.id,
            recipientId: recipient.id,
            smtpAccountId,
            idempotencyKey: `${campaign.id}:${recipient.id}:${campaign.templateId}`
          };
        });

        for (let i = 0; i < dataRows.length; i += insertChunkSize) {
          const batch = dataRows.slice(i, i + insertChunkSize);
          if (batch.length === 0) continue;
          const result = await prisma.campaignRecipient.createMany({
            data: batch,
            skipDuplicates: true
          });
          inserted += result.count;
        }

        if (chunkIndex % 5 === 0) {
          await prisma.campaignLog.create({
            data: {
              campaignId: campaign.id,
              eventType: "campaign_start_progress",
              status: "success",
              message: `scan=${scanned} inserted=${inserted} suppressed=${suppressedSkipped}`
            }
          });
        }
      }
    } catch (error) {
      await prisma.campaignLog.create({
        data: {
          campaignId: campaign.id,
          eventType: "campaign_start_failed",
          status: "failed",
          message: `Campaign recipient import failed: ${(error as Error).message}`
        }
      });
      throw new Error("campaign_import_failed");
    }

    const totalTargeted = await prisma.campaignRecipient.count({
      where: { campaignId: campaign.id }
    });
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "running",
        startedAt: campaign.startedAt ?? new Date(),
        totalTargeted
      }
    });

    await prisma.campaignLog.create({
      data: {
        campaignId: campaign.id,
        eventType: "campaign_started",
        status: "success",
        message: `Campaign started. targeted=${totalTargeted} scanned=${scanned} active=${activeCandidates} inserted=${inserted} suppressedSkipped=${suppressedSkipped}`
      }
    });
    try {
      await campaignQueue.add(
        "campaign_start",
        { campaignId: campaign.id, trigger: "manual" },
        { jobId: `campaign_start:${campaign.id}` }
      );
    } catch {
      await prisma.campaignLog.create({
        data: {
          campaignId: campaign.id,
          eventType: "campaign_queue_failed",
          status: "failed",
          message: "Campaign started but queue enqueue failed."
        }
      });
      throw new Error("campaign_queue_failed");
    }

    return updated;
  });
}

export async function pauseCampaign(campaignId: string) {
  const result = await prisma.campaign.updateMany({
    where: { id: campaignId, status: "running" },
    data: { status: "paused" }
  });
  if (result.count === 0) {
    throw new Error("campaign_pause_failed");
  }
  await prisma.campaignLog.create({
    data: {
      campaignId,
      eventType: "campaign_paused",
      status: "success"
    }
  });
}

export async function resumeCampaign(campaignId: string) {
  return withCampaignLock(campaignId, "resume", async () => {
    const result = await prisma.campaign.updateMany({
      where: { id: campaignId, status: "paused" },
      data: { status: "running" }
    });
    if (result.count === 0) {
      throw new Error("campaign_resume_failed");
    }
    await campaignQueue.add(
      "campaign_resume",
      { campaignId, trigger: "resume" },
      { jobId: `campaign_resume:${campaignId}` }
    );
    await prisma.campaignLog.create({
      data: {
        campaignId,
        eventType: "campaign_resumed",
        status: "success"
      }
    });
  });
}

export async function cancelCampaign(campaignId: string) {
  return prisma.$transaction(async (tx: any) => {
    const result = await tx.campaign.updateMany({
      where: { id: campaignId, status: { in: ["queued", "running", "paused", "pending"] } },
      data: { status: "canceled", finishedAt: new Date(), stoppedEarly: true }
    });
    if (result.count === 0) {
      throw new Error("campaign_cancel_failed");
    }

    await tx.campaignRecipient.updateMany({
      where: { campaignId, sendStatus: { in: ["pending", "queued", "failed"] } },
      data: { sendStatus: "skipped" }
    });
    await tx.campaignLog.create({
      data: {
        campaignId,
        eventType: "campaign_canceled",
        status: "success"
      }
    });
  });
}
