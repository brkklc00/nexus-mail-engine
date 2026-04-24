import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id: listId } = await params;

  const list = await prisma.recipientList.findUnique({
    where: { id: listId },
    include: {
      memberships: {
        include: { recipient: true }
      }
    }
  });

  if (!list) {
    return NextResponse.json({ ok: false, error: "List not found" }, { status: 404 });
  }

  const header = "email,firstName,lastName,name,status";
  const lines = list.memberships.map((membership: any) => {
    const r = membership.recipient;
    return [r.email, r.firstName ?? "", r.lastName ?? "", r.name ?? "", r.status].join(",");
  });
  const csv = [header, ...lines].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"list-${listId}.csv\"`
    }
  });
}
