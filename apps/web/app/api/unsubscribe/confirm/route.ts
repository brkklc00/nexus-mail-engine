import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getRedisClient } from "@nexus/queue";
import { verifyTrackingToken } from "@/server/tracking/token.service";
import { getUnsubscribeSettings } from "@/server/unsubscribe/settings";
import { verifyCaptcha } from "@/server/unsubscribe/captcha";

const schema = z.object({
  email: z.string().email().optional(),
  token: z.string().optional(),
  captchaId: z.string().min(1),
  captchaCode: z.string().optional()
});

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  if (name.length <= 2) return `${name[0] ?? "*"}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function resolveIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function checkRateLimit(key: string, windowMs: number, max: number) {
  try {
    const result = await getRedisClient().eval(
      `
      local current = redis.call("INCR", KEYS[1])
      if current == 1 then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
      end
      return current
      `,
      1,
      key,
      String(windowMs)
    );
    return Number(result) <= max;
  } catch {
    return true;
  }
}

export async function POST(req: Request) {
  const settings = await getUnsubscribeSettings();
  if (!settings.enabled) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 403 });
  }

  const payload = schema.safeParse(await req.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const requesterIp = resolveIp(req);
  const ipRateOk = await checkRateLimit(`unsubscribe:confirm:ip:${requesterIp}`, 60_000, 30);
  if (!ipRateOk) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  if (settings.captchaEnabled) {
    const captcha = await verifyCaptcha(payload.data.captchaId, String(payload.data.captchaCode ?? ""));
    if (!captcha.ok) {
      return NextResponse.json({ ok: false, error: settings.errorMessage }, { status: 400 });
    }
  }

  let resolvedEmail: string | null = null;
  const token = String(payload.data.token ?? "").trim();
  if (token) {
    const secret = process.env.TRACKING_SECRET ?? "change-me";
    const decoded = verifyTrackingToken(token, secret);
    if (decoded && decoded.type === "unsubscribe") {
      const recipient = await prisma.recipient.findUnique({
        where: { id: decoded.recipientId },
        select: { email: true }
      });
      if (recipient?.email) {
        resolvedEmail = normalizeEmail(recipient.email);
      }
    }
  }

  if (!resolvedEmail && settings.requireToken) {
    return NextResponse.json({ ok: false, error: settings.errorMessage }, { status: 400 });
  }
  if (!resolvedEmail && settings.allowManualEmailInput && payload.data.email) {
    resolvedEmail = normalizeEmail(payload.data.email);
  }
  if (!resolvedEmail) {
    return NextResponse.json({
      ok: true,
      message: "E-posta adresiniz isleme alindi.",
      removedFromLists: 0,
      addedToSuppression: false,
      alreadySuppressed: false
    });
  }

  const emailRateOk = await checkRateLimit(`unsubscribe:confirm:email:${resolvedEmail}`, 5 * 60_000, 10);
  if (!emailRateOk) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const recipients = await prisma.recipient.findMany({
    where: { emailNormalized: resolvedEmail },
    select: { id: true }
  });
  const recipientIds = recipients.map((item: { id: string }) => item.id);

  let removedFromLists = 0;
  if (settings.removeFromAllLists && recipientIds.length > 0) {
    const deleteMemberships = await prisma.recipientListMembership.deleteMany({
      where: { recipientId: { in: recipientIds } }
    });
    removedFromLists = deleteMemberships.count;
  }

  if (recipientIds.length > 0) {
    await prisma.recipient.updateMany({
      where: { id: { in: recipientIds } },
      data: { status: "unsubscribed" }
    });
  }

  let addedToSuppression = false;
  let alreadySuppressed = false;
  if (settings.addToSuppression) {
    const existing = await prisma.suppressionEntry.findUnique({
      where: {
        emailNormalized_scope: {
          emailNormalized: resolvedEmail,
          scope: "global"
        }
      }
    });
    if (existing) {
      alreadySuppressed = true;
      await prisma.suppressionEntry.update({
        where: {
          emailNormalized_scope: {
            emailNormalized: resolvedEmail,
            scope: "global"
          }
        },
        data: {
          source: "unsubscribe_page",
          reason: settings.suppressionReason
        }
      });
    } else {
      await prisma.suppressionEntry.create({
        data: {
          email: resolvedEmail,
          emailNormalized: resolvedEmail,
          scope: "global",
          reason: settings.suppressionReason,
          source: "unsubscribe_page"
        }
      });
      addedToSuppression = true;
    }
  }

  await prisma.auditLog.create({
    data: {
      action: "unsubscribe_completed",
      resource: "public_unsubscribe_page",
      metadata: {
        emailMasked: maskEmail(resolvedEmail),
        source: "public_unsubscribe_page",
        removedFromLists,
        addedToSuppression,
        alreadySuppressed
      }
    }
  });

  return NextResponse.json({
    ok: true,
    message: "E-posta adresiniz isleme alindi.",
    removedFromLists,
    addedToSuppression,
    alreadySuppressed
  });
}

