import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { recordClickEvent } from "@/server/tracking/tracking-events.service";
import { verifyTrackingToken } from "@/server/tracking/token.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const secret = process.env.TRACKING_SECRET ?? "change-me";
  const payload = verifyTrackingToken(token, secret);

  if (!payload || payload.type !== "click" || !payload.campaignLinkId) {
    return NextResponse.redirect(new URL("/dashboard", request.url), { status: 302 });
  }

  const link = await prisma.campaignLink.findUnique({
    where: { id: payload.campaignLinkId }
  });
  if (!link) {
    return NextResponse.redirect(new URL("/dashboard", request.url), { status: 302 });
  }

  await recordClickEvent(
    payload.campaignId,
    payload.recipientId,
    link.id,
    link.originalUrl,
    {
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent")
    }
  );

  return NextResponse.redirect(link.originalUrl, { status: 302 });
}
