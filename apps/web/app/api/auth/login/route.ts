import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { verifyPassword } from "@/server/auth/password";
import { createSessionCookie } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(req: Request) {
  const payload = schema.safeParse(await req.json());
  if (!payload.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: payload.data.email.toLowerCase() }
  });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!verifyPassword(payload.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await createSessionCookie({ id: user.id, email: user.email, role: user.role });
  await writeAuditLog(user.id, "auth.login", "user", { email: user.email });
  return NextResponse.json({ ok: true });
}
