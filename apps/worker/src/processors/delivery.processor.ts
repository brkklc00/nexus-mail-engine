import type { Job } from "bullmq";
import crypto from "node:crypto";
import { prisma } from "@nexus/db";
import type { DeliveryJob } from "@nexus/queue";
import { MailTemplateRenderer } from "@nexus/mailer";
import { decryptSmtpSecret } from "@nexus/security";
import nodemailer from "nodemailer";
import { getEffectiveSendRate } from "../rate/effective-rate-runtime.service.js";
import { canDispatch } from "../rate/pacing-engine.js";
import { applySafetyToRate, recordDeliveryOutcome } from "../safety/distributed-safety.service.js";
import { transitionCampaignRecipientStatus } from "../state/campaign-recipient-state.service.js";
import { safeCreateCampaignLog } from "../logging/safe-campaign-log.js";

const renderer = new MailTemplateRenderer();
const WORKER_SETTINGS_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_SETTINGS_CACHE_MS ?? 30_000));
const WORKER_SMTP_CACHE_MS = Math.max(1_000, Number(process.env.WORKER_SMTP_CACHE_MS ?? 30_000));
const WORKER_QUOTA_CACHE_MS = Math.max(500, Number(process.env.WORKER_QUOTA_CACHE_MS ?? 3_000));
const RATE_APPLY_LOG_INTERVAL_MS = Math.max(10_000, Number(process.env.RATE_APPLY_LOG_INTERVAL_MS ?? 60_000));
const RATE_APPLY_DIAG_CACHE_MS = Math.max(5_000, Number(process.env.RATE_APPLY_DIAG_CACHE_MS ?? 10_000));
let cachedPoolSetting: { value: unknown; expiresAt: number } | null = null;
const smtpPoolCache = new Map<string, { rows: any[]; expiresAt: number }>();
const smtpQuotaCache = new Map<string, { value: { dailySent: number; hourlySent: number; minuteSent: number }; expiresAt: number }>();
const lastRateApplyLogByLane = new Map<string, { ts: number; effectiveRate: number; bottleneck: string }>();
let cachedRateApplyDiagnostics: { value: Record<string, unknown>; expiresAt: number } | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isPrismaPoolTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Timed out fetching a new connection from the connection pool") ||
    message.includes("connection pool timeout")
  );
}

function beginOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function readSmtpQuotaUsage(smtpAccountId: string) {
  const now = Date.now();
  const cached = smtpQuotaCache.get(smtpAccountId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const [dailyWarmup, hourlyRows, minuteRows] = await Promise.all([
    prisma.smtpWarmupStat.findUnique({
      where: {
        smtpAccountId_date: {
          smtpAccountId,
          date: beginOfDay()
        }
      },
      select: { successfulDeliveries: true }
    }),
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "CampaignLog" cl
      WHERE cl."eventType" = 'sent'
        AND (cl.metadata->>'smtpAccountId') = ${smtpAccountId}
        AND cl."createdAt" >= NOW() - INTERVAL '1 hour'
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "CampaignLog" cl
      WHERE cl."eventType" = 'sent'
        AND (cl.metadata->>'smtpAccountId') = ${smtpAccountId}
        AND cl."createdAt" >= NOW() - INTERVAL '1 minute'
    `
  ]);
  const value = {
    dailySent: Number(dailyWarmup?.successfulDeliveries ?? 0),
    hourlySent: Number(hourlyRows[0]?.total ?? 0),
    minuteSent: Number(minuteRows[0]?.total ?? 0)
  };
  smtpQuotaCache.set(smtpAccountId, { value, expiresAt: now + WORKER_QUOTA_CACHE_MS });
  return value;
}

function signTrackingToken(payload: {
  campaignId: string;
  recipientId: string;
  type: "open" | "click" | "unsubscribe";
  campaignLinkId?: string;
  targetUrl?: string;
  expiresAt: number;
}) {
  const secret = process.env.TRACKING_SECRET ?? "change-me";
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function normalizeHref(href: string): string | null {
  if (!href) return null;
  if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return null;
  return href;
}

function isMissingCampaignSoftDeleteColumn(message: string): boolean {
  return /column .*isdeleted.* does not exist/i.test(message);
}

function smtpEligibilityReason(smtp: any): string | null {
  if (!smtp?.isActive) return "disabled";
  if (smtp?.isSoftDeleted) return "archived";
  if (!smtp?.host || !smtp?.port || !smtp?.username || !smtp?.fromEmail || !smtp?.passwordEncrypted) return "missing_credentials";
  const authText = `${smtp?.healthStatus ?? ""} ${smtp?.throttleReason ?? ""} ${smtp?.lastError ?? ""}`.toLowerCase();
  if (authText.includes("auth_failed") || authText.includes("authentication") || authText.includes("invalid credentials")) {
    return "auth_failed";
  }
  if (smtp?.healthStatus === "error") return "unhealthy";
  if (smtp?.isThrottled && smtp?.cooldownUntil && new Date(smtp.cooldownUntil).getTime() > Date.now()) return "throttled";
  return null;
}

async function findCampaignForDelivery(campaignId: string) {
  const select = {
    id: true,
    name: true,
    subject: true,
    status: true,
    smtpAccountId: true,
    smtpPoolConfig: true,
    throttleReason: true,
    effectiveRate: true,
    totalTargeted: true,
    totalFailed: true,
    totalSkipped: true,
    template: {
      select: {
        id: true,
        htmlBody: true,
        plainTextBody: true
      }
    }
  } as const;

  try {
    return await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        isDeleted: false
      },
      select
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign.lookup] failed", { campaignId, message });
    if (!isMissingCampaignSoftDeleteColumn(message)) {
      return null;
    }
    return prisma.campaign.findUnique({
      where: { id: campaignId },
      select
    });
  }
}

async function ensureCampaignLink(campaignId: string, originalUrl: string) {
  const token = crypto.createHash("sha256").update(`${campaignId}:${originalUrl}`).digest("hex").slice(0, 48);
  return prisma.campaignLink.upsert({
    where: { token },
    create: {
      campaignId,
      originalUrl,
      token
    },
    update: {}
  });
}

async function buildTrackedHtml(html: string, campaignId: string, recipientId: string) {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const now = Date.now();
  const links = Array.from(html.matchAll(/href="([^"]+)"/g)).map((match) => match[1]);
  const uniqueLinks = Array.from(new Set(links.map(normalizeHref).filter(Boolean))) as string[];
  const campaignLinks = await Promise.all(
    uniqueLinks.map(async (url) => {
      const link = await ensureCampaignLink(campaignId, url);
      return [url, link] as const;
    })
  );
  const linkMap = new Map(campaignLinks);

  const rewritten = html.replace(/href="([^"]+)"/g, (_all, href: string) => {
    const normalized = normalizeHref(href);
    if (!normalized) {
      return `href="${href}"`;
    }
    const link = linkMap.get(normalized);
    if (!link) {
      return `href="${href}"`;
    }
    const token = signTrackingToken({
      campaignId,
      recipientId,
      type: "click",
      campaignLinkId: link.id,
      expiresAt: now + 1000 * 60 * 60 * 24 * 60
    });
    return `href="${baseUrl}/track/click/${token}"`;
  });

  const openToken = signTrackingToken({
    campaignId,
    recipientId,
    type: "open",
    expiresAt: now + 1000 * 60 * 60 * 24 * 7
  });
  const unsubscribeToken = signTrackingToken({
    campaignId,
    recipientId,
    type: "unsubscribe",
    expiresAt: now + 1000 * 60 * 60 * 24 * 365
  });

  const pixel = `<img src="${baseUrl}/track/open/${openToken}" width="1" height="1" style="display:none;" alt="" />`;
  const unsubscribe = `${baseUrl}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const withMeta = rewritten
    .replace(/\{\{tracking_pixel\}\}/g, pixel)
    .replace(/\{\{unsubscribe_url\}\}/g, unsubscribe);
  if (withMeta.includes("</body>")) {
    return withMeta.replace("</body>", `${pixel}</body>`);
  }
  return `${withMeta}${pixel}`;
}

async function readSchedulerDiagnostics() {
  const now = Date.now();
  if (cachedRateApplyDiagnostics && cachedRateApplyDiagnostics.expiresAt > now) {
    return cachedRateApplyDiagnostics.value;
  }
  const row = await prisma.appSetting.findUnique({ where: { key: "scheduler_runtime_diagnostics" } }).catch(() => null);
  const value = ((row?.value as any) ?? {}) as Record<string, unknown>;
  cachedRateApplyDiagnostics = {
    value,
    expiresAt: now + RATE_APPLY_DIAG_CACHE_MS
  };
  return value;
}

async function finalizeCampaignIfDone(campaignId: string) {
  const pendingCount = await prisma.campaignRecipient.count({ where: { campaignId, sendStatus: "pending" } });
  let campaign:
    | {
        id: string;
        totalFailed: number;
        totalSkipped: number;
        totalTargeted: number;
      }
    | null = null;
  try {
    campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, isDeleted: false },
      select: {
        id: true,
        totalFailed: true,
        totalSkipped: true,
        totalTargeted: true
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[campaign.lookup] failed", { campaignId, message });
    if (isMissingCampaignSoftDeleteColumn(message)) {
      campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          totalFailed: true,
          totalSkipped: true,
          totalTargeted: true
        }
      });
    } else {
      campaign = null;
    }
  }
  if (!campaign || pendingCount > 0) {
    return;
  }
  const completedStatus =
    campaign.totalFailed > 0 || campaign.totalSkipped > 0 ? "partially_completed" : "completed";
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: completedStatus,
      finishedAt: new Date(),
      failureRate:
        campaign.totalTargeted > 0 ? Number((campaign.totalFailed / campaign.totalTargeted).toFixed(4)) : 0
    }
  });
}

export async function processDelivery(job: Job<DeliveryJob>): Promise<void> {
  const payload = job.data;

  const existing = await prisma.campaignLog
    .findUnique({
      where: { idempotencyKey: payload.idempotencyKey }
    })
    .catch((error: unknown) => {
      if (isPrismaPoolTimeout(error)) {
        console.warn("[delivery.idempotency] campaignLog read skipped due to pool timeout");
        return null;
      }
      throw error;
    });
  if (existing) {
    return;
  }

  const campaign = await findCampaignForDelivery(payload.campaignId);
  const recipient = await prisma.recipient.findUnique({ where: { id: payload.recipientId } });
  const campaignRecipient = await prisma.campaignRecipient.findUnique({
    where: {
      campaignId_recipientId: {
        campaignId: payload.campaignId,
        recipientId: payload.recipientId
      }
    },
    select: {
      sendStatus: true
    }
  });

  if (!campaign) {
    return;
  }
  if (!campaignRecipient || ["sent", "failed", "skipped"].includes(campaignRecipient.sendStatus)) {
    return;
  }
  if (!recipient || !campaign.template) {
    throw new Error("delivery_missing_entities");
  }
  if (campaignRecipient.sendStatus === "pending") {
    await transitionCampaignRecipientStatus({
      campaignId: payload.campaignId,
      recipientId: payload.recipientId,
      to: "queued"
    }).catch(() => false);
  }
  const poolSmtpIds = Array.isArray(((campaign as any).smtpPoolConfig as any)?.smtpIds)
    ? ((((campaign as any).smtpPoolConfig as any).smtpIds as string[]))
    : [campaign.smtpAccountId];
  const poolCacheKey = poolSmtpIds.slice().sort().join(",");
  const nowMs = Date.now();
  const activePool = smtpPoolCache.get(poolCacheKey)?.expiresAt && (smtpPoolCache.get(poolCacheKey)?.expiresAt ?? 0) > nowMs
    ? (smtpPoolCache.get(poolCacheKey)?.rows ?? [])
    : await prisma.smtpAccount.findMany({
      where: {
        id: { in: poolSmtpIds },
        isActive: true,
        isSoftDeleted: false
      },
      orderBy: { createdAt: "asc" }
    });
  if (!smtpPoolCache.get(poolCacheKey) || (smtpPoolCache.get(poolCacheKey)?.expiresAt ?? 0) <= nowMs) {
    smtpPoolCache.set(poolCacheKey, { rows: activePool as any[], expiresAt: nowMs + WORKER_SMTP_CACHE_MS });
  }
  if (activePool.length === 0) {
    throw new Error("smtp_pool_exhausted");
  }
  const eligiblePool = activePool.filter((smtp: any) => smtpEligibilityReason(smtp) === null);
  const fallbackSmtp = eligiblePool.find((smtp: any) => smtp.id === payload.smtpAccountId) ?? eligiblePool[0];
  if (!fallbackSmtp) {
    throw new Error("smtp_pool_exhausted");
  }
  const selected = fallbackSmtp;
  if (selected.id !== payload.smtpAccountId) {
    await prisma.campaignRecipient.updateMany({
      where: { campaignId: campaign.id, recipientId: recipient.id },
      data: { smtpAccountId: selected.id }
    });
  }
  if (campaign.status !== "running") {
    const skipped = await transitionCampaignRecipientStatus({
      campaignId: campaign.id,
      recipientId: recipient.id,
      to: "skipped"
    });
    if (skipped) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { totalSkipped: { increment: 1 } }
      });
    }
    await finalizeCampaignIfDone(campaign.id);
    return;
  }
  if (recipient.status !== "active") {
    const skipped = await transitionCampaignRecipientStatus({
      campaignId: campaign.id,
      recipientId: recipient.id,
      to: "skipped"
    });
    if (skipped) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { totalSkipped: { increment: 1 } }
      });
    }
    await finalizeCampaignIfDone(campaign.id);
    return;
  }

  const suppressed = await prisma.suppressionEntry.findFirst({
    where: {
      emailNormalized: recipient.emailNormalized,
      scope: "global"
    },
    select: { id: true }
  });
  if (suppressed || recipient.status === "unsubscribed") {
    const skipped = await transitionCampaignRecipientStatus({
      campaignId: campaign.id,
      recipientId: recipient.id,
      to: "skipped"
    });
    if (skipped) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { totalSkipped: { increment: 1 } }
      });
      await safeCreateCampaignLog({
        campaignId: campaign.id,
        recipientId: recipient.id,
        eventType: "suppression_skip",
        status: "skipped",
        message: "Recipient skipped due to suppression/unsubscribe safety checks."
      });
    }
    await finalizeCampaignIfDone(campaign.id);
    return;
  }

  const quotaUsage = await readSmtpQuotaUsage(selected.id);
  const dailyCap = Number(selected.dailyCap ?? 0);
  const hourlyCap = Number(selected.hourlyCap ?? 0);
  const minuteCap = Number(selected.minuteCap ?? 0);
  const capReached =
    (dailyCap > 0 && quotaUsage.dailySent >= dailyCap) ||
    (hourlyCap > 0 && quotaUsage.hourlySent >= hourlyCap) ||
    (minuteCap > 0 && quotaUsage.minuteSent >= minuteCap);
  if (capReached) {
    const skipped = await transitionCampaignRecipientStatus({
      campaignId: campaign.id,
      recipientId: recipient.id,
      to: "skipped"
    });
    if (skipped) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { totalSkipped: { increment: 1 } }
      });
      await safeCreateCampaignLog({
        campaignId: campaign.id,
        recipientId: recipient.id,
        eventType: "smtp_quota_reached",
        status: "skipped",
        message: `SMTP quota reached for ${selected.id}`,
        metadata: {
          smtpAccountId: selected.id,
          dailyCap,
          hourlyCap,
          minuteCap,
          dailySent: quotaUsage.dailySent,
          hourlySent: quotaUsage.hourlySent,
          minuteSent: quotaUsage.minuteSent
        }
      });
    }
    await finalizeCampaignIfDone(campaign.id);
    return;
  }

  const decision = await getEffectiveSendRate({
    smtpAccountId: selected.id,
    campaignId: campaign.id,
    activePoolSmtpCount: Math.max(1, activePool.length)
  });
  const safetyRate = await applySafetyToRate(selected.id, decision.effectiveRatePerSecond);
  const enforcedRate = Math.max(0.01, safetyRate.rate);
  const laneKey = `${campaign.id}:${selected.id}`;
  const forceTargetLane = decision.reasons.includes("force_target_override");
  const bottleneck = forceTargetLane
    ? safetyRate.reason ?? "none"
    : safetyRate.reason ??
      (decision.reasons.some((reason) => reason.includes("warmup")) ? "warmup_cap" : decision.reasons.length > 0 ? "rate_limit" : "none");
  const lastRateApply = lastRateApplyLogByLane.get(laneKey);
  const now = Date.now();
  const changedEnough =
    !lastRateApply ||
    Math.abs(lastRateApply.effectiveRate - enforcedRate) >= Math.max(0.2, lastRateApply.effectiveRate * 0.15) ||
    lastRateApply.bottleneck !== bottleneck;
  if (!lastRateApply || changedEnough || now - lastRateApply.ts >= RATE_APPLY_LOG_INTERVAL_MS) {
    lastRateApplyLogByLane.set(laneKey, {
      ts: now,
      effectiveRate: enforcedRate,
      bottleneck
    });
    const targetTotalRps = Number((((campaign as any).smtpPoolConfig as any)?.targetTotalRps ?? 0));
    const schedulerDiag = await readSchedulerDiagnostics();
    const dbPendingRecipients = Number(schedulerDiag.dbPendingRecipients ?? 0);
    const redisWaitingJobs = Number(schedulerDiag.redisWaitingJobs ?? 0);
    const redisActiveJobs = Number(schedulerDiag.redisActiveJobs ?? 0);
    const actualRps = Number((campaign as any).effectiveRate ?? 0);
    const activeLanes = Math.max(1, activePool.length);
    const avgPerSmtpRps = Number((enforcedRate / activeLanes).toFixed(4));
    console.info("[rate.apply]", {
      campaignId: campaign.id,
      targetTotalRps,
      actualRps,
      activeLanes,
      eligibleSmtp: activeLanes,
      dbPendingRecipients,
      redisWaitingJobs,
      redisActiveJobs,
      avgPerSmtpRps,
      smtpEmail: selected.fromEmail,
      resolvedRatePerSecond: enforcedRate,
      bottleneck
    });
  }
  const dynamicDelayMs = Math.max(10, Math.min(1000, Math.round(1000 / enforcedRate)));
  const maxWaitMs = Math.max(1_000, Number(process.env.RATE_LIMIT_WAIT_TIMEOUT_MS ?? 60_000));
  await safeCreateCampaignLog({
    campaignId: campaign.id,
    eventType: "campaign_rate_debug",
    status: "success",
    idempotencyKey: `campaign_rate_debug:${campaign.id}:${selected.id}`,
    message: "Resolved effective send rate for SMTP lane.",
    metadata: {
      globalRate: decision.globalRatePerSecond,
      parallelSMTP: decision.parallelSmtpCount,
      perSMTPRate: decision.perSmtpRate,
      effectiveRate: enforcedRate
    }
  });
  for (let waitedMs = 0; waitedMs <= maxWaitMs; waitedMs += dynamicDelayMs) {
    if (canDispatch(`smtp:${selected.id}`, enforcedRate)) {
      break;
    }
    await sleep(dynamicDelayMs);
    if (waitedMs + dynamicDelayMs > maxWaitMs) {
      throw new Error("rate_limited_wait_timeout");
    }
  }

  const rendered = renderer.render({
    htmlBody: campaign.template.htmlBody,
    plainTextBody: campaign.template.plainTextBody,
    variables: {
      name: recipient.name ?? "",
      email: recipient.email,
      first_name: recipient.firstName ?? "",
      last_name: recipient.lastName ?? ""
    }
  });
  const trackedHtml = await buildTrackedHtml(rendered.html, campaign.id, recipient.id);

  const transporter = nodemailer.createTransport({
    host: selected.host,
    port: selected.port,
    secure: selected.encryption === "ssl",
    requireTLS: selected.encryption === "tls" || selected.encryption === "starttls",
    auth: {
      user: selected.username,
      pass: decryptSmtpSecret(selected.passwordEncrypted)
    }
  });

  try {
    await transporter.sendMail({
      from: `"${selected.fromName ?? "Nexus"}" <${selected.fromEmail}>`,
      to: recipient.email,
      subject: campaign.subject,
      html: trackedHtml,
      text: rendered.text,
      replyTo: selected.replyTo ?? undefined
    });

    const transitioned = await transitionCampaignRecipientStatus({
      campaignId: campaign.id,
      recipientId: recipient.id,
      to: "sent",
      sentAt: new Date()
    });
    if (!transitioned) {
      return;
    }

    await prisma.$transaction([
      prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          totalSent: { increment: 1 },
          effectiveRate: enforcedRate,
          throttleReason: safetyRate.reason ?? decision.reasons.join(",")
        }
      }),
      prisma.smtpWarmupStat.upsert({
        where: {
          smtpAccountId_date: {
            smtpAccountId: selected.id,
            date: beginOfDay()
          }
        },
        create: {
          smtpAccountId: selected.id,
          date: beginOfDay(),
          successfulDeliveries: 1,
          tierName: decision.warmupTierName,
          effectiveRate: enforcedRate
        },
        update: {
          successfulDeliveries: { increment: 1 },
          tierName: decision.warmupTierName,
          effectiveRate: enforcedRate
        }
      })
    ]);
    await safeCreateCampaignLog({
      campaignId: campaign.id,
      recipientId: recipient.id,
      eventType: "sent",
      status: "success",
      idempotencyKey: payload.idempotencyKey,
      message: `Delivered via ${selected.host}`,
      metadata: {
        smtpAccountId: selected.id,
        effectiveRate: enforcedRate,
        globalRate: decision.globalRatePerSecond,
        parallelSMTP: decision.parallelSmtpCount,
        perSMTPRate: decision.perSmtpRate,
        reasons: safetyRate.reason ? [...decision.reasons, safetyRate.reason] : decision.reasons,
        warmupTier: decision.warmupTierName
      }
    });
    await recordDeliveryOutcome(selected.id, false);
    await prisma.smtpAccount.update({
      where: { id: selected.id },
      data: {
        healthStatus: "healthy",
        lastError: null,
        lastSuccessAt: new Date(),
        cooldownUntil: null
      }
    });
    await finalizeCampaignIfDone(campaign.id);
  } catch (error) {
    if (error instanceof Error && error.message === "rate_limited_wait_timeout") {
      await safeCreateCampaignLog({
        campaignId: campaign.id,
        recipientId: recipient.id,
        eventType: "rate_limited_delayed",
        status: "skipped",
        message: "Rate token bulunamadı; alıcı başarısız işaretlenmeden yeniden denenecek.",
        metadata: {
          smtpAccountId: selected.id,
          effectiveRate: enforcedRate,
          waitTimeoutMs: maxWaitMs
        }
      });
      throw error;
    }
    const failed = await transitionCampaignRecipientStatus({
      campaignId: campaign.id,
      recipientId: recipient.id,
      to: "failed"
    });
    if (failed) {
      await prisma.$transaction([
        prisma.campaign.update({
          where: { id: campaign.id },
          data: { totalFailed: { increment: 1 } }
        }),
        prisma.smtpWarmupStat.upsert({
          where: {
            smtpAccountId_date: {
              smtpAccountId: selected.id,
              date: beginOfDay()
            }
          },
          create: {
            smtpAccountId: selected.id,
            date: beginOfDay(),
            failedDeliveries: 1
          },
          update: {
            failedDeliveries: { increment: 1 }
          }
        })
      ]);
    }
    await recordDeliveryOutcome(selected.id, true);
    const now = Date.now();
    const poolSetting = cachedPoolSetting && cachedPoolSetting.expiresAt > now
      ? cachedPoolSetting
      : await prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } })
          .then((row: { value?: unknown } | null) => {
            const next = { value: row?.value ?? {}, expiresAt: now + WORKER_SETTINGS_CACHE_MS };
            cachedPoolSetting = next;
            return next;
          })
          .catch(() => ({ value: {}, expiresAt: now + WORKER_SETTINGS_CACHE_MS }));
    const cooldownSec = Number((poolSetting?.value as any)?.cooldownAfterErrorSec ?? 0);
    const cooldownUntil = cooldownSec > 0 ? new Date(Date.now() + cooldownSec * 1000) : null;
    await prisma.smtpAccount.update({
      where: { id: selected.id },
      data: {
        healthStatus: "error",
        lastError: error instanceof Error ? error.message.slice(0, 500) : "delivery_failed",
        cooldownUntil
      }
    });
    await finalizeCampaignIfDone(campaign.id);
    throw error;
  }
}
