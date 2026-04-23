import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { getQueueObservability } from "@/server/observability/queue-observability.service";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = await getQueueObservability();
  return NextResponse.json(data);
}
