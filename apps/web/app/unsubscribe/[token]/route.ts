import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { suppressRecipient } from "@/server/tracking/tracking-events.service";
import { verifyTrackingToken } from "@/server/tracking/token.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const secret = process.env.TRACKING_SECRET ?? "change-me";
  const payload = verifyTrackingToken(token, secret);

  if (!payload || payload.type !== "unsubscribe") {
    return NextResponse.redirect(new URL("/dashboard", request.url), { status: 302 });
  }

  const recipient = await prisma.recipient.findUnique({
    where: { id: payload.recipientId }
  });

  if (recipient) {
    await suppressRecipient(recipient.id, recipient.email, "unsubscribe_link");
  }

  return NextResponse.json({
    ok: true,
    message: "You are unsubscribed from future messages."
  });
}
