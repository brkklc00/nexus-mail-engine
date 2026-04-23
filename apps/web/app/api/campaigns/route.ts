import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { writeAuditLog } from "@/server/auth/guard";
import { createCampaign } from "@/server/campaigns/orchestration.service";

const createSchema = z.object({
  name: z.string().min(2),
  templateId: z.string().uuid(),
  listId: z.string().uuid().optional(),
  smtpAccountId: z.string().uuid(),
  scheduledAt: z.string().datetime().optional()
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = createSchema.safeParse(await req.json());
  if (!payload.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const campaign = await createCampaign({
      name: payload.data.name,
      templateId: payload.data.templateId,
      listId: payload.data.listId,
      smtpAccountId: payload.data.smtpAccountId,
      scheduledAt: payload.data.scheduledAt ? new Date(payload.data.scheduledAt) : null
    });
    await writeAuditLog(session.userId, "campaign.create", "campaign", { campaignId: campaign.id });
    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
