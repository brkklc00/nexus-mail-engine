import { NextResponse } from "next/server";
import { recordOpenEvent } from "@/server/tracking/tracking-events.service";
import { verifyTrackingToken } from "@/server/tracking/token.service";

const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=",
  "base64"
);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const secret = process.env.TRACKING_SECRET ?? "change-me";
  const payload = verifyTrackingToken(token, secret);

  if (!payload || payload.type !== "open") {
    return new NextResponse(PIXEL_GIF, {
      headers: { "Content-Type": "image/gif" }
    });
  }

  await recordOpenEvent(payload.campaignId, payload.recipientId, {
    ip: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent")
  });

  return new NextResponse(PIXEL_GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, max-age=0"
    }
  });
}
