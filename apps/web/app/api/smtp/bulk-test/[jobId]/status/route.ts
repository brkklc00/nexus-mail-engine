import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { getBulkSmtpTestJob } from "@/server/smtp/bulk-test-jobs";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { jobId } = await params;
  const state = getBulkSmtpTestJob(jobId);
  if (!state) {
    return NextResponse.json({ ok: false, error: "Job bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    jobId: state.jobId,
    status: state.status,
    total: state.total,
    queuedOrProcessed: state.queuedOrProcessed,
    results: state.results,
    summary: state.summary,
    error: state.error ?? null
  });
}
