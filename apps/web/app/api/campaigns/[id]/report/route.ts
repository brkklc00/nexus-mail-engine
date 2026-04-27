import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

function toCsvRow(values: Array<string | number | null | undefined>): string {
  return values
    .map((value) => {
      const text = `${value ?? ""}`.replaceAll('"', '""');
      return `"${text}"`;
    })
    .join(",");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const format = (new URL(req.url).searchParams.get("format") ?? "summary").trim().toLowerCase();
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      totalTargeted: true,
      totalSent: true,
      totalFailed: true,
      totalSkipped: true,
      totalOpened: true,
      totalClicked: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true
    }
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (format === "summary") {
    const deliveryRate = campaign.totalTargeted
      ? Number(((campaign.totalSent / campaign.totalTargeted) * 100).toFixed(2))
      : 0;
    return NextResponse.json({
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      createdAt: campaign.createdAt.toISOString(),
      startedAt: campaign.startedAt?.toISOString() ?? null,
      finishedAt: campaign.finishedAt?.toISOString() ?? null,
      totals: {
        targeted: campaign.totalTargeted,
        sent: campaign.totalSent,
        failed: campaign.totalFailed,
        skipped: campaign.totalSkipped,
        opened: campaign.totalOpened,
        clicked: campaign.totalClicked,
        deliveryRate
      }
    });
  }

  if (!["failed", "skipped", "suppressed", "all"].includes(format)) {
    return NextResponse.json({ error: "Invalid format" }, { status: 400 });
  }

  const statusFilter =
    format === "all"
      ? ["queued", "pending", "sent", "failed", "skipped"]
      : format === "suppressed"
        ? ["skipped"]
        : [format];

  const rows = await prisma.campaignRecipient.findMany({
    where: { campaignId: id, sendStatus: { in: statusFilter as any } },
    include: {
      recipient: { select: { email: true, emailNormalized: true } }
    },
    orderBy: { updatedAt: "desc" },
    take: 100_000
  });

  const csvLines = [
    toCsvRow(["campaign_id", "campaign_name", "email", "email_normalized", "send_status", "provider_message_id", "updated_at"])
  ];
  for (const row of rows) {
    if (format === "suppressed" && row.sendStatus !== "skipped") continue;
    csvLines.push(
      toCsvRow([
        campaign.id,
        campaign.name,
        row.recipient.email,
        row.recipient.emailNormalized,
        row.sendStatus,
        row.providerMessageId,
        row.updatedAt.toISOString()
      ])
    );
  }
  const csv = `${csvLines.join("\n")}\n`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campaign-${campaign.id}-${format}-report.csv"`
    }
  });
}
