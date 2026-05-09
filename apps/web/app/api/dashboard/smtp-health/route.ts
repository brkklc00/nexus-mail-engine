import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function loadSmtpHealth() {
  const [smtpStates, smtpTotalCount, smtpHealthyCount, smtpThrottledCount, smtpErrorCount] = await Promise.all([
    prisma.smtpAccount.findMany({
      where: { isSoftDeleted: false },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, name: true, isThrottled: true, throttleReason: true, providerLabel: true }
    }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isThrottled: false } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, isThrottled: true } }),
    prisma.smtpAccount.count({ where: { isSoftDeleted: false, healthStatus: "error" } })
  ]);

  return {
    smtpTotals: {
      total: smtpTotalCount,
      healthy: smtpHealthyCount,
      throttled: smtpThrottledCount,
      error: smtpErrorCount
    },
    smtpStates
  };
}

export async function GET() {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await withTimeout(loadSmtpHealth(), 3000);
    console.info("[dashboard.smtp-health] completed", { ms: Date.now() - startedAt });
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    console.warn("[dashboard.widget] slow", { widget: "smtp_health", ms: Date.now() - startedAt });
    return NextResponse.json({
      ok: true,
      partial: true,
      smtpTotals: { total: 0, healthy: 0, throttled: 0, error: 0 },
      smtpStates: [],
      error: error instanceof Error ? error.message : "Yüklenemedi"
    });
  }
}
