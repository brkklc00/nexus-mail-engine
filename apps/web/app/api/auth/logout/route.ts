import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

export async function POST() {
  const session = await getSession();
  if (session) {
    await writeAuditLog(session.userId, "auth.logout", "user", { email: session.email });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
