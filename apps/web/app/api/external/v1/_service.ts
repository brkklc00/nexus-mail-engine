import { z } from "zod";
import { prisma } from "@nexus/db";
import { writeAuditLog } from "@/server/auth/guard";
import { createCampaign, startCampaign } from "@/server/campaigns/orchestration.service";

const poolDefaults = {
  sendingMode: "pool",
  rotateEvery: 500,
  parallelSmtpLanes: 1
} as const;

export const externalCampaignSchema = z.object({
  name: z.string().min(2),
  templateId: z.string().uuid(),
  targetType: z.enum(["list", "segment"]),
  targetId: z.string().uuid(),
  smtpMode: z.enum(["pool"]).default("pool"),
  strategy: z.enum(["round_robin", "warmup_weighted", "least_used"]).default("round_robin"),
  rotateEvery: z.number().int().min(1).max(50000).default(500),
  parallelSmtpCount: z.number().int().min(1).max(50).default(1),
  smtpAccountIds: z.array(z.string().uuid()).optional().default([])
});

type SmtpSummaryRow = {
  id: string;
  name: string;
  isActive: boolean;
  isSoftDeleted: boolean;
  isThrottled: boolean;
  healthStatus: string;
  targetRatePerSecond: number;
  maxRatePerSecond: number | null;
};

function mapStrategy(strategy: "round_robin" | "warmup_weighted" | "least_used"): "round_robin" | "weighted_warmup" | "least_used" {
  if (strategy === "warmup_weighted") return "weighted_warmup";
  return strategy;
}

export async function getSafeTemplateList(options?: { onlyActive?: boolean }) {
  const where = options?.onlyActive ? { status: "active" as const } : undefined;
  const templates = await prisma.mailTemplate.findMany({
    where,
    select: { id: true, title: true, subject: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 300
  });
  return templates.map((item: any) => ({
    id: item.id,
    name: item.title,
    subject: item.subject,
    status: item.status
  }));
}

export async function getSafeRecipientLists() {
  const lists = await prisma.recipientList.findMany({
    select: { id: true, name: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 300
  });
  const summaryRows = (await prisma.$queryRaw`
    SELECT
      m."listId" AS "listId",
      COUNT(*)::bigint AS "totalCount",
      COUNT(*) FILTER (WHERE r.status <> 'invalid')::bigint AS "validCount",
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM "SuppressionEntry" s
          WHERE s."emailNormalized" = r."emailNormalized"
            AND (s.scope = 'global' OR (s.scope = 'list' AND s."listId" = m."listId"))
        )
      )::bigint AS "suppressedCount"
    FROM "RecipientListMembership" m
    JOIN "Recipient" r ON r.id = m."recipientId"
    GROUP BY m."listId"
  `) as Array<{ listId: string; totalCount: bigint; validCount: bigint; suppressedCount: bigint }>;
  const summaryMap = new Map<string, { totalCount: number; validCount: number; suppressedCount: number }>(
    summaryRows.map((row) => [
      row.listId,
      {
        totalCount: Number(row.totalCount),
        validCount: Number(row.validCount),
        suppressedCount: Number(row.suppressedCount)
      }
    ])
  );
  return lists.map((list: any) => {
    const counts = summaryMap.get(list.id) ?? { totalCount: 0, validCount: 0, suppressedCount: 0 };
    return {
      id: list.id,
      name: list.name,
      totalCount: counts.totalCount,
      validCount: counts.validCount,
      suppressedCount: counts.suppressedCount
    };
  });
}

export async function getSmtpPoolSummary() {
  const [smtpRows, poolRow] = await Promise.all([
    prisma.smtpAccount.findMany({
      where: { isSoftDeleted: false },
      select: {
        id: true,
        name: true,
        isActive: true,
        isSoftDeleted: true,
        isThrottled: true,
        healthStatus: true,
        targetRatePerSecond: true,
        maxRatePerSecond: true
      }
    }) as Promise<SmtpSummaryRow[]>,
    prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } })
  ]);
  const active = smtpRows.filter((item) => item.isActive && !item.isSoftDeleted);
  const usable = active.filter((item) => item.healthStatus !== "error");
  const estimatedTotalRps = usable.reduce(
    (sum, smtp) => sum + Number(smtp.maxRatePerSecond ?? smtp.targetRatePerSecond ?? 0),
    0
  );
  const settings = ((poolRow?.value as any) ?? poolDefaults) as {
    sendingMode?: "single" | "pool";
    rotateEvery?: number;
    parallelSmtpLanes?: number;
  };
  return {
    smtpRows,
    summary: {
      total: smtpRows.length,
      active: active.length,
      healthy: active.filter((item) => item.healthStatus === "healthy").length,
      throttled: active.filter((item) => item.isThrottled).length,
      estimatedTotalRps: Number(estimatedTotalRps.toFixed(2)),
      usableCount: usable.length
    },
    poolSettings: {
      mode: settings.sendingMode ?? "pool",
      rotateEvery: Math.max(1, Number(settings.rotateEvery ?? 500)),
      parallelSmtpCount: Math.max(1, Number(settings.parallelSmtpLanes ?? 1))
    },
    defaults: {
      targetType: "list",
      smtpMode: "pool",
      strategy: "round_robin",
      rotateEvery: Math.max(1, Number(settings.rotateEvery ?? 500)),
      parallelSmtpCount: Math.max(1, Number(settings.parallelSmtpLanes ?? 1))
    }
  };
}

export async function validateExternalCampaignInput(
  input: z.infer<typeof externalCampaignSchema>
): Promise<{
  template: { id: string; status: string };
  estimatedTargetCount: number;
  selectedSmtpIds: string[];
  selectedSmtpCount: number;
  estimatedThroughput: number;
  warnings: string[];
}> {
  const [template, list, segment, smtpCandidates] = await Promise.all([
    prisma.mailTemplate.findUnique({ where: { id: input.templateId }, select: { id: true, status: true } }),
    input.targetType === "list"
      ? prisma.recipientList.findUnique({ where: { id: input.targetId }, select: { id: true, name: true } })
      : Promise.resolve(null),
    input.targetType === "segment"
      ? prisma.segment.findUnique({
          where: { id: input.targetId },
          select: { id: true, isArchived: true, lastMatchedCount: true }
        })
      : Promise.resolve(null),
    prisma.smtpAccount.findMany({
      where: {
        isActive: true,
        isSoftDeleted: false,
        ...(input.smtpAccountIds.length > 0 ? { id: { in: input.smtpAccountIds } } : {})
      },
      select: { id: true, maxRatePerSecond: true, targetRatePerSecond: true }
    })
  ]);

  if (!template || template.status !== "active") {
    throw new Error("template_not_found");
  }
  if (input.targetType === "list" && !list) {
    throw new Error("target_not_found");
  }
  if (input.targetType === "segment" && (!segment || segment.isArchived)) {
    throw new Error("target_not_found");
  }
  if (smtpCandidates.length === 0) {
    throw new Error("no_smtp_accounts");
  }

  let estimatedTargetCount = 0;
  if (input.targetType === "list") {
    const rows = (await prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS count
      FROM "RecipientListMembership" m
      JOIN "Recipient" r ON r.id = m."recipientId"
      WHERE m."listId" = ${input.targetId}
        AND r.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM "SuppressionEntry" s
          WHERE s.scope = 'global'
            AND s."emailNormalized" = r."emailNormalized"
        )
    `) as Array<{ count: bigint }>;
    estimatedTargetCount = Number(rows[0]?.count ?? 0);
  } else {
    estimatedTargetCount = Number(segment?.lastMatchedCount ?? 0);
  }
  if (estimatedTargetCount <= 0) {
    throw new Error("no_recipients");
  }

  const selectedSmtpIds = smtpCandidates.map((smtp: any) => smtp.id);
  const selectedSmtpCount = selectedSmtpIds.length;
  const estimatedThroughput = Number(
    smtpCandidates
      .reduce((sum: number, smtp: any) => sum + Number(smtp.maxRatePerSecond ?? smtp.targetRatePerSecond ?? 0), 0)
      .toFixed(2)
  );
  const warnings: string[] = [];
  if (input.parallelSmtpCount > selectedSmtpCount) {
    warnings.push("parallel_smtp_count_exceeds_selected_smtp_count");
  }

  return {
    template,
    estimatedTargetCount,
    selectedSmtpIds,
    selectedSmtpCount,
    estimatedThroughput,
    warnings
  };
}

export async function startExternalCampaign(
  input: z.infer<typeof externalCampaignSchema>
): Promise<{
  campaignId: string;
  status: string;
  estimatedTargetCount: number;
  selectedSmtpCount: number;
  rotateEvery: number;
  parallelSmtpCount: number;
  warnings: string[];
}> {
  const validation = await validateExternalCampaignInput(input);
  const campaign = await createCampaign({
    name: input.name,
    templateId: input.templateId,
    listId: input.targetType === "list" ? input.targetId : undefined,
    segmentId: input.targetType === "segment" ? input.targetId : undefined,
    targetMode: input.targetType === "list" ? "list" : "saved_segment",
    smtpMode: "pool",
    smtpIds: validation.selectedSmtpIds,
    parallelSmtpCount: input.parallelSmtpCount,
    rotateEvery: input.rotateEvery,
    strategy: mapStrategy(input.strategy)
  });

  const started = await startCampaign(campaign.id);
  await writeAuditLog(null, "external_api.campaign_start", "campaign", {
    endpoint: "/api/external/v1/campaigns/start",
    campaignId: campaign.id,
    targetType: input.targetType,
    targetId: input.targetId,
    selectedSmtpCount: validation.selectedSmtpCount,
    recipientCount: validation.estimatedTargetCount
  });

  return {
    campaignId: campaign.id,
    status: started.status,
    estimatedTargetCount: validation.estimatedTargetCount,
    selectedSmtpCount: validation.selectedSmtpCount,
    rotateEvery: input.rotateEvery,
    parallelSmtpCount: input.parallelSmtpCount,
    warnings: validation.warnings
  };
}

