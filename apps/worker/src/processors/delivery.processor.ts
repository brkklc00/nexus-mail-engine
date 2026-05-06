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

const renderer = new MailTemplateRenderer();

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function beginOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function readSmtpQuotaUsage(smtpAccountId: string) {
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
  return {
    dailySent: Number(dailyWarmup?.successfulDeliveries ?? 0),
    hourlySent: Number(hourlyRows[0]?.total ?? 0),
    minuteSent: Number(minuteRows[0]?.total ?? 0)
  };
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

async function findCampaignForDelivery(campaignId: string) {
  const select = {
    id: true,
    name: true,
    subject: true,
    status: true,
    smtpAccountId: true,
    smtpPoolConfig: true,
    throttleReason: true,
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
  const unsubscribe = `${baseUrl}/unsubscribe/${unsubscribeToken}`;
  const withMeta = rewritten
    .replace(/\{\{tracking_pixel\}\}/g, pixel)
    .replace(/\{\{unsubscribe_url\}\}/g, unsubscribe);
  if (withMeta.includes("</body>")) {
    return withMeta.replace("</body>", `${pixel}</body>`);
  }
  return `${withMeta}${pixel}`;
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

  const existing = await prisma.campaignLog.findUnique({
    where: { idempotencyKey: payload.idempotencyKey }
  });
  if (existing) {
    return;
  }

  const campaign = await findCampaignForDelivery(payload.campaignId);
  const recipient = await prisma.recipient.findUnique({ where: { id: payload.recipientId } });

  if (!campaign) {
    return;
  }
  if (!recipient || !campaign.template) {
    throw new Error("delivery_missing_entities");
  }
  const poolSmtpIds = Array.isArray(((campaign as any).smtpPoolConfig as any)?.smtpIds)
    ? ((((campaign as any).smtpPoolConfig as any).smtpIds as string[]))
    : [campaign.smtpAccountId];
  const activePool = await prisma.smtpAccount.findMany({
    where: {
      id: { in: poolSmtpIds },
      isActive: true,
      isSoftDeleted: false
    },
    orderBy: { createdAt: "asc" }
  });
  const selectedSmtp =
    activePool.find((smtp: any) => smtp.id === payload.smtpAccountId) ??
    activePool[0];
  if (!selectedSmtp) {
    throw new Error("smtp_pool_exhausted");
  }
  if (selectedSmtp.id !== payload.smtpAccountId) {
    await prisma.campaignRecipient.updateMany({
      where: { campaignId: campaign.id, recipientId: recipient.id },
      data: { smtpAccountId: selectedSmtp.id }
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

  const quotaUsage = await readSmtpQuotaUsage(selectedSmtp.id);
  const dailyCap = Number(selectedSmtp.dailyCap ?? 0);
  const hourlyCap = Number(selectedSmtp.hourlyCap ?? 0);
  const minuteCap = Number(selectedSmtp.minuteCap ?? 0);
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
      await prisma.$transaction([
        prisma.campaign.update({
          where: { id: campaign.id },
          data: { totalSkipped: { increment: 1 } }
        }),
        prisma.campaignLog.create({
          data: {
            campaignId: campaign.id,
            recipientId: recipient.id,
            eventType: "smtp_quota_reached",
            status: "skipped",
            message: `SMTP quota reached for ${selectedSmtp.id}`,
            metadata: {
              smtpAccountId: selectedSmtp.id,
              dailyCap,
              hourlyCap,
              minuteCap,
              dailySent: quotaUsage.dailySent,
              hourlySent: quotaUsage.hourlySent,
              minuteSent: quotaUsage.minuteSent
            }
          }
        })
      ]);
    }
    await finalizeCampaignIfDone(campaign.id);
    return;
  }

  const decision = await getEffectiveSendRate({
    smtpAccountId: selectedSmtp.id,
    campaignId: campaign.id,
    activePoolSmtpCount: Math.max(1, activePool.length)
  });
  const safetyRate = await applySafetyToRate(selectedSmtp.id, decision.effectiveRatePerSecond);
  const enforcedRate = Math.max(0.01, safetyRate.rate);
  const dynamicDelayMs = Math.max(10, Math.min(1000, Math.round(1000 / enforcedRate)));
  const maxWaitMs = 3_000;
  await prisma.campaignLog.create({
    data: {
      campaignId: campaign.id,
      eventType: "campaign_rate_debug",
      status: "success",
      idempotencyKey: `campaign_rate_debug:${campaign.id}:${selectedSmtp.id}`,
      message: "Resolved effective send rate for SMTP lane.",
      metadata: {
        globalRate: decision.globalRatePerSecond,
        parallelSMTP: decision.parallelSmtpCount,
        perSMTPRate: decision.perSmtpRate,
        effectiveRate: enforcedRate
      }
    }
  }).catch(() => undefined);
  for (let waitedMs = 0; waitedMs <= maxWaitMs; waitedMs += dynamicDelayMs) {
    if (canDispatch(`smtp:${selectedSmtp.id}`, enforcedRate)) {
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
    host: selectedSmtp.host,
    port: selectedSmtp.port,
    secure: selectedSmtp.encryption === "ssl",
    requireTLS: selectedSmtp.encryption === "tls" || selectedSmtp.encryption === "starttls",
    auth: {
      user: selectedSmtp.username,
      pass: decryptSmtpSecret(selectedSmtp.passwordEncrypted)
    }
  });

  try {
    await transporter.sendMail({
      from: `"${selectedSmtp.fromName ?? "Nexus"}" <${selectedSmtp.fromEmail}>`,
      to: recipient.email,
      subject: campaign.subject,
      html: trackedHtml,
      text: rendered.text,
      replyTo: selectedSmtp.replyTo ?? undefined
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
      prisma.campaignLog.create({
        data: {
          campaignId: campaign.id,
          recipientId: recipient.id,
          eventType: "sent",
          status: "success",
          idempotencyKey: payload.idempotencyKey,
          message: `Delivered via ${selectedSmtp.host}`,
          metadata: {
            smtpAccountId: selectedSmtp.id,
            effectiveRate: enforcedRate,
            globalRate: decision.globalRatePerSecond,
            parallelSMTP: decision.parallelSmtpCount,
            perSMTPRate: decision.perSmtpRate,
            reasons: safetyRate.reason ? [...decision.reasons, safetyRate.reason] : decision.reasons,
            warmupTier: decision.warmupTierName
          }
        }
      }),
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
            smtpAccountId: selectedSmtp.id,
            date: beginOfDay()
          }
        },
        create: {
          smtpAccountId: selectedSmtp.id,
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
    await recordDeliveryOutcome(selectedSmtp.id, false);
    await prisma.smtpAccount.update({
      where: { id: selectedSmtp.id },
      data: {
        healthStatus: "healthy",
        lastError: null,
        lastSuccessAt: new Date(),
        cooldownUntil: null
      }
    });
    await finalizeCampaignIfDone(campaign.id);
  } catch (error) {
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
              smtpAccountId: selectedSmtp.id,
              date: beginOfDay()
            }
          },
          create: {
            smtpAccountId: selectedSmtp.id,
            date: beginOfDay(),
            failedDeliveries: 1
          },
          update: {
            failedDeliveries: { increment: 1 }
          }
        })
      ]);
    }
    await recordDeliveryOutcome(selectedSmtp.id, true);
    const poolSetting = await prisma.appSetting.findUnique({ where: { key: "smtp_pool_settings" } });
    const cooldownSec = Number((poolSetting?.value as any)?.cooldownAfterErrorSec ?? 0);
    const cooldownUntil = cooldownSec > 0 ? new Date(Date.now() + cooldownSec * 1000) : null;
    await prisma.smtpAccount.update({
      where: { id: selectedSmtp.id },
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
