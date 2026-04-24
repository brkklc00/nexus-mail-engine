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
  try {
    const payload = schema.safeParse(await req.json());
    if (!payload.success) {
      console.warn("auth.login invalid_payload");
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const normalizedEmail = payload.data.email.toLowerCase();
    console.info("auth.login attempt", { email: normalizedEmail });

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });
    console.info("auth.login user_lookup", { email: normalizedEmail, found: Boolean(user), active: user?.isActive ?? false });

    if (!user || !user.isActive) {
      console.warn("auth.login invalid_credentials", { email: normalizedEmail, reason: "user_missing_or_inactive" });
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const passwordMatch = verifyPassword(payload.data.password, user.passwordHash);
    console.info("auth.login password_check", { email: normalizedEmail, match: passwordMatch });
    if (!passwordMatch) {
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    await createSessionCookie({ id: user.id, email: user.email, role: user.role });
    console.info("auth.login cookie_set", { email: normalizedEmail, set: true });

    await writeAuditLog(user.id, "auth.login", "user", { email: user.email });
    console.info("auth.login success", { email: normalizedEmail, status: 200 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("auth.login unexpected_error", error);
    return NextResponse.json({ ok: false, error: "Login failed" }, { status: 500 });
  }
}
