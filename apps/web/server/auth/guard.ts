import { redirect } from "next/navigation";
import { prisma } from "@nexus/db";
import { getSession } from "./session";

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function writeAuditLog(userId: string | null, action: string, resource: string, metadata?: unknown) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      resource,
      metadata: metadata ? (metadata as object) : undefined
    }
  });
}
