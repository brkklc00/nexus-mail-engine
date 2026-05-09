import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";
import { createBulkSmtpTestJob } from "@/server/smtp/bulk-test-jobs";

const schema = z.object({
  scope: z.enum(["all_active", "healthy", "throttled", "error", "selected", "filtered"]),
  ids: z.array(z.string().min(1)).optional(),
  filters: z
    .object({
      search: z.string().optional(),
      status: z.string().optional(),
      provider: z.string().optional()
    })
    .optional(),
  testType: z.enum(["connection", "send_test_email", "both"]),
  testRecipient: z.string().email().optional(),
  concurrency: z.number().int().min(1).max(20).default(5),
  timeoutSeconds: z.number().int().min(5).max(120).default(30),
  updateHealth: z.boolean().default(true),
  clearThrottleOnSuccess: z.boolean().default(false),
  onlyActive: z.boolean().default(true)
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Geçersiz istek" }, { status: 400 });
  }
  let resolvedRecipient = parsed.data.testRecipient;
  if (!resolvedRecipient && (parsed.data.testType === "send_test_email" || parsed.data.testType === "both")) {
    const row = await prisma.appSetting.findUnique({ where: { key: "smtp_test_recipient_email" } });
    const value = typeof row?.value === "string" ? row.value : process.env.SMTP_TEST_RECIPIENT;
    resolvedRecipient = typeof value === "string" ? value.trim() : undefined;
  }
  if (
    (parsed.data.testType === "send_test_email" || parsed.data.testType === "both") &&
    !resolvedRecipient
  ) {
    return NextResponse.json({ ok: false, error: "Test alıcı e-postası gerekli" }, { status: 400 });
  }
  const { jobId } = await createBulkSmtpTestJob({
    scope: parsed.data.scope,
    ids: parsed.data.ids,
    filters: parsed.data.filters,
    testType: parsed.data.testType,
    testRecipient: resolvedRecipient,
    concurrency: parsed.data.concurrency,
    timeoutSeconds: parsed.data.timeoutSeconds,
    updateHealth: parsed.data.updateHealth,
    clearThrottleOnSuccess: parsed.data.clearThrottleOnSuccess,
    onlyActive: parsed.data.onlyActive
  });
  return NextResponse.json({ ok: true, jobId });
}
