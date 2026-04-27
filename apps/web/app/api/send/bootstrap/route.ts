import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { getQueueObservability } from "@/server/observability/queue-observability.service";

const defaultPoolSettings = {
  sendingMode: "pool",
  useAllActiveByDefault: true,
  rotateEvery: 500,
  parallelSmtpLanes: 1,
  perSmtpConcurrency: 1,
  skipThrottled: true,
  skipUnhealthy: true,
  fallbackToNextOnError: true,
  retryCount: 3,
  retryDelayMs: 2000,
  cooldownAfterErrorSec: 60
} as const;

function isUnknownSegmentFieldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Unknown argument `isArchived`") || message.includes("Unknown argument `lastMatchedCount`");
}

function isUnknownSmtpFieldError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid `prisma.smtpAccount") && message.includes("Unknown argument");
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const segmentsPromise = prisma.segment
      .findMany({
        where: { isArchived: false, lastMatchedCount: { gt: 0 } },
        select: { id: true, name: true, lastMatchedCount: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 200
      })
      .catch(async (error: unknown) => {
        if (isUnknownSegmentFieldError(error)) {
          const legacyRows = await prisma.segment.findMany({
            select: { id: true, name: true, updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take: 200
          });
          return legacyRows.map((row: { id: string; name: string; updatedAt: Date }) => ({ ...row, lastMatchedCount: 0 }));
        }
        console.error("[send.bootstrap] segment query failed", error);
        return [] as Array<{ id: string; name: string; updatedAt: Date; lastMatchedCount: number }>;
      });

    const smtpPromise = prisma.smtpAccount
      .findMany({
        where: { isActive: true, isSoftDeleted: false },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          name: true,
          host: true,
          port: true,
          encryption: true,
          username: true,
          fromEmail: true,
          providerLabel: true,
          isActive: true,
          healthStatus: true,
          isThrottled: true,
          targetRatePerSecond: true,
          maxRatePerSecond: true
        }
      })
      .catch(async (error: unknown) => {
        if (isUnknownSmtpFieldError(error)) {
          const legacyRows = await prisma.smtpAccount.findMany({
            where: { isActive: true, isSoftDeleted: false },
            orderBy: { createdAt: "desc" },
            take: 200,
            select: {
              id: true,
              name: true,
              host: true,
              port: true,
              encryption: true,
              username: true,
              fromEmail: true,
              providerLabel: true,
              isActive: true,
              isThrottled: true,
              targetRatePerSecond: true,
              maxRatePerSecond: true
            }
          });
          return legacyRows.map((row: any) => ({ ...row, healthStatus: row.healthStatus ?? "healthy" }));
        }
        console.error("[send.bootstrap] smtp query failed", error);
        return [] as Array<{
          id: string;
          name: string;
          host: string;
          port: number;
          encryption: string;
          username: string;
          fromEmail: string;
          providerLabel: string | null;
          isActive: boolean;
          healthStatus: string | null;
          isThrottled: boolean;
          targetRatePerSecond: number;
          maxRatePerSecond: number | null;
        }>;
      });

    const [templatesRaw, listsRaw, smtpRaw, campaignsRaw, segmentsRaw, poolSettingsRaw, queueObs] = await Promise.all([
      prisma.mailTemplate.findMany({
        where: { status: { in: ["active", "draft"] } },
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: 200
      }),
      prisma.recipientList.findMany({
        orderBy: { updatedAt: "desc" },
        take: 200,
        include: {
          _count: {
            select: { memberships: true }
          }
        }
      }),
      smtpPromise,
      prisma.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, name: true, status: true }
      }),
      segmentsPromise,
      prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } }),
      getQueueObservability()
    ]);

    const templates = templatesRaw.map((item: any) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      warning: item.status === "draft" ? "Draft template selected" : null
    }));
    const lists = listsRaw
      .map((list: any) => ({
        id: list.id,
        name: list.name,
        estimatedRecipients: Number(list._count?.memberships ?? 0)
      }))
      .filter((list: any) => list.estimatedRecipients > 0);
    const segments = segmentsRaw.map((segment: any) => ({
      id: segment.id,
      name: segment.name,
      lastMatchedCount: Number(segment.lastMatchedCount ?? 0),
      updatedAt: segment.updatedAt.toISOString()
    }));
    const smtpAccounts = smtpRaw.map((smtp: any) => ({
      id: smtp.id,
      name: smtp.name,
      host: smtp.host,
      port: Number(smtp.port ?? 0),
      encryption: smtp.encryption,
      username: smtp.username,
      fromEmail: smtp.fromEmail,
      providerLabel: smtp.providerLabel ?? null,
      isActive: smtp.isActive !== false,
      targetRatePerSecond: Number(smtp.targetRatePerSecond ?? 0),
      maxRatePerSecond: smtp.maxRatePerSecond ? Number(smtp.maxRatePerSecond) : null,
      isThrottled: Boolean(smtp.isThrottled),
      healthStatus: smtp.healthStatus ?? null,
      warning:
        smtp.healthStatus && smtp.healthStatus !== "healthy"
          ? `SMTP health: ${smtp.healthStatus}`
          : smtp.isThrottled
            ? "SMTP is throttled"
            : null
    }));
    console.info(`[send.bootstrap] smtpAccounts loaded: ${smtpAccounts.length}`);

    const poolSettings = ((poolSettingsRaw?.value as any) ?? defaultPoolSettings) as {
      sendingMode?: "single" | "pool";
      rotateEvery?: number;
      parallelSmtpLanes?: number;
      useAllActiveByDefault?: boolean;
    };
    const defaults = {
      targetType: "list" as const,
      smtpMode: (poolSettings.sendingMode ?? "pool") as "single" | "pool",
      strategy: "round_robin" as const,
      rotateEvery: Math.max(1, Number(poolSettings.rotateEvery ?? 500)),
      parallelSmtpCount: Math.max(1, Math.min(Number(poolSettings.parallelSmtpLanes ?? 1), Math.max(1, smtpAccounts.length)))
    };

    return NextResponse.json({
      ok: true,
      templates,
      lists,
      segments,
      smtpAccounts,
      smtps: smtpAccounts,
      campaigns: campaignsRaw,
      poolSettings: {
        ...defaultPoolSettings,
        ...(poolSettingsRaw?.value as any)
      },
      defaults,
      queue: {
        waiting: Number(queueObs.deliveryCounts?.waiting ?? queueObs.deliveryCounts?.wait ?? 0),
        active: Number(queueObs.deliveryCounts?.active ?? 0),
        failed: Number(queueObs.deliveryCounts?.failed ?? 0)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bootstrap error";
    console.error("[send.bootstrap] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Bootstrap failed",
        reason: message,
        templates: [],
        lists: [],
        segments: [],
        smtpAccounts: [],
        poolSettings: defaultPoolSettings
      },
      { status: 500 }
    );
  }
}
