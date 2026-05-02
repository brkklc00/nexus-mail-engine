import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { createCampaign } from "@/server/campaigns/orchestration.service";
import { getQueueObservability } from "@/server/observability/queue-observability.service";

const createSchema = z.object({
  name: z.string().min(2),
  templateId: z.string().uuid(),
  listId: z.string().uuid().optional(),
  segmentId: z.string().uuid().optional(),
  segmentQueryConfig: z.any().optional(),
  targetMode: z.enum(["list", "saved_segment", "ad_hoc_segment"]).optional(),
  smtpAccountId: z.string().uuid().optional(),
  smtpMode: z.enum(["single", "pool"]).default("single"),
  smtpIds: z.array(z.string().uuid()).optional(),
  parallelSmtpCount: z.number().int().min(1).max(50).optional(),
  rotateEvery: z.number().int().min(1).max(50000).optional(),
  strategy: z.enum(["round_robin", "rotate_every_n", "weighted_warmup", "warmup_weighted", "least_used", "health_based"]).optional(),
  scheduledAt: z.string().datetime().optional(),
  autoShortenLinks: z.boolean().optional()
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = createSchema.safeParse(await req.json());
  if (!payload.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const campaign = await createCampaign({
      name: payload.data.name,
      templateId: payload.data.templateId,
      listId: payload.data.listId,
      segmentId: payload.data.segmentId,
      segmentQueryConfig: payload.data.segmentQueryConfig,
      targetMode: payload.data.targetMode,
      smtpAccountId: payload.data.smtpAccountId,
      smtpMode: payload.data.smtpMode,
      smtpIds: payload.data.smtpIds,
      parallelSmtpCount: payload.data.parallelSmtpCount,
      rotateEvery: payload.data.rotateEvery,
      strategy: payload.data.strategy,
      scheduledAt: payload.data.scheduledAt ? new Date(payload.data.scheduledAt) : null,
      autoShortenLinks: payload.data.autoShortenLinks ?? false
    });
    await writeAuditLog(session.userId, "campaign.create", "campaign", { campaignId: campaign.id });
    return NextResponse.json({ campaign });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "template_not_found") {
      return NextResponse.json({ error: "Template was not found or is not accessible." }, { status: 400 });
    }
    if (message === "list_required") {
      return NextResponse.json({ error: "A list must be selected in list targeting mode." }, { status: 400 });
    }
    if (message === "segment_required") {
      return NextResponse.json({ error: "A segment must be selected in saved segment mode." }, { status: 400 });
    }
    if (message === "segment_query_required") {
      return NextResponse.json({ error: "Segment query is required in ad-hoc segment mode." }, { status: 400 });
    }
    if (message === "segment_archived") {
      return NextResponse.json({ error: "Archived segment cannot be used as campaign target." }, { status: 400 });
    }
    if (message === "smtp_pool_empty") {
      return NextResponse.json({ error: "No active SMTP pool was found or pool is exhausted." }, { status: 400 });
    }
    if (message === "campaign_target_required") {
      return NextResponse.json({ error: "Campaign target is required. Select a list or segment." }, { status: 400 });
    }
    if (message === "shortener_not_configured") {
      return NextResponse.json({ error: "Shortener API is not configured.", code: message }, { status: 503 });
    }
    if (message === "shortener_auth_failed") {
      return NextResponse.json({ error: "Shortener API authentication failed.", code: message }, { status: 401 });
    }
    if (message === "invalid_destination_url") {
      return NextResponse.json({ error: "Invalid destination URL detected during auto-shortening.", code: message }, { status: 400 });
    }
    if (message === "duplicate_alias") {
      return NextResponse.json({ error: "Short link alias already exists.", code: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function clampPage(value: string | null): number {
  const parsed = Number(value ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function normalizePageSize(value: string | null): number {
  const parsed = Number(value ?? "25");
  if (!Number.isFinite(parsed)) return 25;
  return [25, 50, 100].includes(parsed) ? parsed : 25;
}

function resolveDateRange(range: string | null, from: string | null, to: string | null): { gte?: Date; lte?: Date } {
  const normalized = (range ?? "all").trim().toLowerCase();
  if (normalized === "all") return {};
  if (normalized === "24h") return { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
  if (normalized === "7d") return { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
  if (normalized === "30d") return { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  if (normalized === "custom" && from) {
    const gte = new Date(from);
    const lte = to ? new Date(to) : new Date();
    if (!Number.isNaN(gte.getTime()) && !Number.isNaN(lte.getTime())) {
      return { gte, lte };
    }
  }
  return {};
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = clampPage(url.searchParams.get("page"));
  const pageSize = normalizePageSize(url.searchParams.get("pageSize"));
  const offset = (page - 1) * pageSize;
  const search = (url.searchParams.get("search") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "all").trim();
  const templateId = (url.searchParams.get("templateId") ?? "").trim();
  const listSegmentId = (url.searchParams.get("listSegmentId") ?? "").trim();
  const smtpAccountId = (url.searchParams.get("smtpAccountId") ?? "").trim();
  const dateWindow = resolveDateRange(
    url.searchParams.get("range"),
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );

  const where: any = {
    ...(search
      ? {
          OR: [{ name: { contains: search, mode: "insensitive" } }, { subject: { contains: search, mode: "insensitive" } }]
        }
      : {}),
    ...(status !== "all" ? { status } : {}),
    ...(templateId ? { templateId } : {}),
    ...(smtpAccountId ? { smtpAccountId } : {}),
    ...(listSegmentId ? { OR: [{ listId: listSegmentId }, { segmentId: listSegmentId }] } : {}),
    ...(dateWindow.gte || dateWindow.lte
      ? {
          createdAt: {
            ...(dateWindow.gte ? { gte: dateWindow.gte } : {}),
            ...(dateWindow.lte ? { lte: dateWindow.lte } : {})
          }
        }
      : {})
  };

  const [campaigns, total, allCampaignsForStats, templates, lists, segments, smtps, queueObs] = await Promise.all([
    prisma.campaign.findMany({
      where,
      include: {
        template: { select: { id: true, title: true } },
        list: { select: { id: true, name: true } },
        segment: { select: { id: true, name: true } },
        smtpAccount: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: pageSize
    }),
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      select: {
        id: true,
        status: true,
        totalTargeted: true,
        totalSent: true,
        totalFailed: true,
        totalSkipped: true,
        totalOpened: true,
        totalClicked: true,
        effectiveRate: true
      }
    }),
    prisma.mailTemplate.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.recipientList.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.segment.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.smtpAccount.findMany({ where: { isSoftDeleted: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getQueueObservability()
  ]);

  const campaignIds = campaigns.map((campaign: any) => campaign.id);
  const [recipientCounts, lastActivityRows] = await Promise.all([
    campaignIds.length
      ? prisma.campaignRecipient.groupBy({
          by: ["campaignId", "sendStatus"],
          where: { campaignId: { in: campaignIds } },
          _count: { _all: true }
        })
      : Promise.resolve([] as any[]),
    campaignIds.length
      ? prisma.campaignLog.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: campaignIds } },
          _max: { createdAt: true }
        })
      : Promise.resolve([] as any[])
  ]);

  const queueCount = (obj: Record<string, any>, keys: string[]) =>
    keys.reduce((sum, key) => sum + Number(obj[key] ?? 0), 0);

  const queueStats = {
    waiting: queueCount(queueObs.deliveryCounts ?? {}, ["waiting", "wait"]),
    active: queueCount(queueObs.deliveryCounts ?? {}, ["active"]),
    failed: queueCount(queueObs.deliveryCounts ?? {}, ["failed"]),
    delayed: queueCount(queueObs.deliveryCounts ?? {}, ["delayed"]),
    retryWaiting: queueCount(queueObs.retryCounts ?? {}, ["waiting", "wait"]),
    deadWaiting: queueCount(queueObs.deadCounts ?? {}, ["waiting", "wait"])
  };

  const recipientCountMap = new Map<string, { queued: number; sent: number; failed: number; skipped: number }>();
  for (const row of recipientCounts as any[]) {
    const existing = recipientCountMap.get(row.campaignId) ?? { queued: 0, sent: 0, failed: 0, skipped: 0 };
    const count = Number(row._count?._all ?? 0);
    if (row.sendStatus === "queued" || row.sendStatus === "pending") existing.queued += count;
    if (row.sendStatus === "sent") existing.sent += count;
    if (row.sendStatus === "failed") existing.failed += count;
    if (row.sendStatus === "skipped") existing.skipped += count;
    recipientCountMap.set(row.campaignId, existing);
  }
  const activityMap = new Map<string, Date | null>(
    (lastActivityRows as any[]).map((row) => [row.campaignId as string, row._max?.createdAt ?? null])
  );

  const statusCounts = {
    totalCampaigns: allCampaignsForStats.length,
    runningCampaigns: allCampaignsForStats.filter((c: any) => c.status === "running").length,
    pausedCampaigns: allCampaignsForStats.filter((c: any) => c.status === "paused").length,
    completedCampaigns: allCampaignsForStats.filter((c: any) => c.status === "completed").length,
    canceledCampaigns: allCampaignsForStats.filter((c: any) => c.status === "canceled").length
  };

  const totalTargeted = allCampaignsForStats.reduce((sum: number, c: any) => sum + (c.totalTargeted ?? 0), 0);
  const totalSent = allCampaignsForStats.reduce((sum: number, c: any) => sum + (c.totalSent ?? 0), 0);
  const totalFailed = allCampaignsForStats.reduce((sum: number, c: any) => sum + (c.totalFailed ?? 0), 0);
  const totalSkipped = allCampaignsForStats.reduce((sum: number, c: any) => sum + (c.totalSkipped ?? 0), 0);
  const totalOpened = allCampaignsForStats.reduce((sum: number, c: any) => sum + (c.totalOpened ?? 0), 0);
  const totalClicked = allCampaignsForStats.reduce((sum: number, c: any) => sum + (c.totalClicked ?? 0), 0);
  const effectiveRates = allCampaignsForStats.map((c: any) => c.effectiveRate).filter((v: any) => typeof v === "number");
  const averageDeliveryRate = effectiveRates.length
    ? Number((effectiveRates.reduce((sum: number, v: number) => sum + v, 0) / effectiveRates.length).toFixed(2))
    : 0;

  const items = campaigns.map((campaign: any) => {
    const counts = recipientCountMap.get(campaign.id) ?? { queued: 0, sent: campaign.totalSent, failed: campaign.totalFailed, skipped: campaign.totalSkipped };
    const completed = counts.sent + counts.failed + counts.skipped;
    const progress = campaign.totalTargeted > 0 ? Math.min(100, Number(((completed / campaign.totalTargeted) * 100).toFixed(2))) : 0;

    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      template: campaign.template ? { id: campaign.template.id, title: campaign.template.title } : null,
      list: campaign.list ? { id: campaign.list.id, name: campaign.list.name } : null,
      segment: campaign.segment ? { id: campaign.segment.id, name: campaign.segment.name } : null,
      smtp: campaign.smtpAccount ? { id: campaign.smtpAccount.id, name: campaign.smtpAccount.name } : null,
      targetedCount: campaign.totalTargeted,
      queuedCount: counts.queued,
      sentCount: counts.sent,
      failedCount: counts.failed,
      skippedCount: counts.skipped,
      openCount: campaign.totalOpened,
      clickCount: campaign.totalClicked,
      progress,
      createdAt: campaign.createdAt.toISOString(),
      lastActivity: activityMap.get(campaign.id)?.toISOString() ?? null
    };
  });

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    stats: {
      ...statusCounts,
      totalTargeted,
      totalSent,
      totalFailed,
      totalSkipped,
      totalOpened,
      totalClicked,
      averageDeliveryRate,
      queue: queueStats
    },
    filters: {
      templates,
      lists,
      segments,
      smtpAccounts: smtps
    }
  });
}
