import { NextResponse } from "next/server";
import { prisma } from "@nexus/db";
import { getSession } from "@/server/auth/session";

type Range = "today" | "7d" | "30d";

type PerformancePayload = {
  range: Range;
  deliveryData: Array<{ label: string; sent: number; failed: number; skipped: number }>;
  engagementData: Array<{ label: string; opens: number; clicks: number; openRate: number; clickRate: number }>;
  failureData: Array<{ reason: string; count: number; percentage: number }>;
};

function getRange(raw: string | null): Range {
  if (raw === "today" || raw === "30d") {
    return raw;
  }
  return "7d";
}

function buildBuckets(range: Range) {
  const analyticsStart = new Date();
  if (range === "today") {
    analyticsStart.setHours(0, 0, 0, 0);
  } else if (range === "30d") {
    analyticsStart.setDate(analyticsStart.getDate() - 29);
    analyticsStart.setHours(0, 0, 0, 0);
  } else {
    analyticsStart.setDate(analyticsStart.getDate() - 6);
    analyticsStart.setHours(0, 0, 0, 0);
  }

  const bucketKeys: string[] = [];
  if (range === "today") {
    for (let hour = 0; hour < 24; hour += 1) {
      bucketKeys.push(String(hour).padStart(2, "0"));
    }
  } else {
    const days = range === "30d" ? 30 : 7;
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      bucketKeys.push(date.toISOString().slice(0, 10));
    }
  }
  return { analyticsStart, bucketKeys };
}

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

async function loadPerformance(range: Range): Promise<PerformancePayload> {
  const { analyticsStart, bucketKeys } = buildBuckets(range);
  const keyForDate = (date: Date) => (range === "today" ? String(date.getHours()).padStart(2, "0") : date.toISOString().slice(0, 10));
  const labelForKey = (key: string) => {
    if (range === "today") return `${key}:00`;
    const parsed = new Date(`${key}T00:00:00`);
    return range === "30d"
      ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : parsed.toLocaleDateString("en-US", { weekday: "short" });
  };

  const [analyticsLogs, analyticsOpenEvents, analyticsClickEvents] = await Promise.all([
    prisma.campaignLog.findMany({
      where: {
        createdAt: { gte: analyticsStart },
        OR: [{ eventType: "sent" }, { status: "failed" }, { status: "skipped" }]
      },
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        eventType: true,
        status: true,
        providerCode: true,
        message: true
      },
      take: range === "30d" ? 5000 : 2500
    }),
    prisma.openEvent.findMany({
      where: { createdAt: { gte: analyticsStart } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
      take: range === "30d" ? 5000 : 2500
    }),
    prisma.clickEvent.findMany({
      where: { createdAt: { gte: analyticsStart } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
      take: range === "30d" ? 5000 : 2500
    })
  ]);

  const trendMap = new Map<string, { sent: number; failed: number; skipped: number; opens: number; clicks: number }>();
  for (const key of bucketKeys) {
    trendMap.set(key, { sent: 0, failed: 0, skipped: 0, opens: 0, clicks: 0 });
  }

  const failureReasonMap = new Map<string, number>();
  for (const log of analyticsLogs) {
    const key = keyForDate(new Date(log.createdAt));
    const current = trendMap.get(key);
    if (current) {
      if (log.eventType === "sent") current.sent += 1;
      if (log.status === "failed") current.failed += 1;
      if (log.status === "skipped") current.skipped += 1;
    }
    if (log.status === "failed") {
      const reason = (log.providerCode ?? log.message ?? "delivery_failed").slice(0, 48);
      failureReasonMap.set(reason, (failureReasonMap.get(reason) ?? 0) + 1);
    }
  }

  for (const row of analyticsOpenEvents) {
    const key = keyForDate(new Date(row.createdAt));
    const current = trendMap.get(key);
    if (current) current.opens += 1;
  }

  for (const row of analyticsClickEvents) {
    const key = keyForDate(new Date(row.createdAt));
    const current = trendMap.get(key);
    if (current) current.clicks += 1;
  }

  const deliveryData = bucketKeys.map((key) => {
    const row = trendMap.get(key) ?? { sent: 0, failed: 0, skipped: 0, opens: 0, clicks: 0 };
    return { label: labelForKey(key), sent: row.sent, failed: row.failed, skipped: row.skipped };
  });
  const engagementData = bucketKeys.map((key) => {
    const row = trendMap.get(key) ?? { sent: 0, failed: 0, skipped: 0, opens: 0, clicks: 0 };
    const openRate = row.sent > 0 ? Number(((row.opens / row.sent) * 100).toFixed(2)) : 0;
    const clickRate = row.sent > 0 ? Number(((row.clicks / row.sent) * 100).toFixed(2)) : 0;
    return { label: labelForKey(key), opens: row.opens, clicks: row.clicks, openRate, clickRate };
  });

  const totalFailures = Array.from(failureReasonMap.values()).reduce((sum, value) => sum + value, 0);
  const failureData = Array.from(failureReasonMap.entries())
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: totalFailures > 0 ? Number(((count / totalFailures) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return { range, deliveryData, engagementData, failureData };
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const range = getRange(url.searchParams.get("range"));

  try {
    const payload = await withTimeout(loadPerformance(range), 3000);
    console.info("[dashboard.performance] completed", { ms: Date.now() - startedAt, range });
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    console.warn("[dashboard.widget] slow", { widget: "performance", ms: Date.now() - startedAt });
    return NextResponse.json({
      ok: true,
      partial: true,
      range,
      deliveryData: [],
      engagementData: [],
      failureData: [],
      error: error instanceof Error ? error.message : "Yüklenemedi"
    });
  }
}
