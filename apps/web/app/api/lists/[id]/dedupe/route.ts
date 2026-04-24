import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;

  const rows = await prisma.recipientListMembership.findMany({
    where: { listId },
    include: { recipient: true },
    orderBy: { createdAt: "asc" }
  });

  const seen = new Set<string>();
  let removed = 0;

  for (const row of rows as any[]) {
    const email = row.recipient.emailNormalized;
    if (!email) continue;
    if (seen.has(email)) {
      await prisma.recipientListMembership.delete({ where: { id: row.id } });
      removed += 1;
      continue;
    }
    seen.add(email);
  }

  await writeAuditLog(session.userId, "list.dedupe", "recipient_list", { listId, removed });
  return NextResponse.json({ ok: true, removed });
}
