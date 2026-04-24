import { Activity, Search } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function LogsPage({
  searchParams
}: {
  searchParams?: Promise<{ q?: string; severity?: string; days?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const q = params.q?.trim() ?? "";
  const severity = params.severity?.trim() ?? "all";
  const days = Number(params.days ?? "7");
  const fromDate = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

  const [campaignLogs, auditLogs] = await Promise.all([
    prisma.campaignLog.findMany({
      where: {
        createdAt: { gte: fromDate },
        ...(severity !== "all"
          ? severity === "failed"
            ? { status: "failed" }
            : severity === "skipped"
              ? { status: "skipped" }
              : { status: "success" }
          : {}),
        ...(q
          ? {
              OR: [
                { eventType: { contains: q, mode: "insensitive" } },
                { message: { contains: q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: 60
    }),
    prisma.auditLog.findMany({
      where: {
        createdAt: { gte: fromDate },
        ...(q
          ? {
              OR: [
                { action: { contains: q, mode: "insensitive" } },
                { resource: { contains: q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: 30
    })
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operational Logs"
        description="Campaign event ve audit log akislarini filtreleyerek takip et."
      />

      <form className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by event, action or message..."
          className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        <select name="severity" defaultValue={severity} className="rounded-md border border-border bg-zinc-900/70 px-2 py-1 text-xs text-zinc-200">
          <option value="all">all</option>
          <option value="success">success</option>
          <option value="failed">failed</option>
          <option value="skipped">skipped</option>
        </select>
        <select name="days" defaultValue={String(days)} className="rounded-md border border-border bg-zinc-900/70 px-2 py-1 text-xs text-zinc-200">
          <option value="1">1d</option>
          <option value="3">3d</option>
          <option value="7">7d</option>
          <option value="30">30d</option>
        </select>
        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs text-zinc-200">Apply</button>
      </form>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-200">Campaign Logs</h3>
          {campaignLogs.length === 0 ? (
            <EmptyState
              icon="activity"
              title="Campaign log yok"
              description="Worker eventleri olustugunda bu alanda gorunur."
            />
          ) : (
            <div className="space-y-2">
              {campaignLogs.map((item: any) => (
                <div key={item.id} className="rounded-xl border border-border bg-zinc-900/60 p-3 text-xs text-zinc-300">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-100">{item.eventType}</span>
                    <StatusBadge
                      label={item.status}
                      tone={item.status === "failed" ? "danger" : item.status === "skipped" ? "warning" : "success"}
                    />
                  </div>
                  <p>{item.message ?? "-"}</p>
                  <p className="mt-1 text-zinc-500">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-200">Audit Logs</h3>
          {auditLogs.length === 0 ? (
            <EmptyState
              icon="activity"
              title="Audit log yok"
              description="Admin/Operator islemleri audit stream olarak burada gorunur."
            />
          ) : (
            <div className="space-y-2">
              {auditLogs.map((item: any) => (
                <div key={item.id} className="rounded-xl border border-border bg-zinc-900/60 p-3 text-xs text-zinc-300">
                  <p className="font-medium text-zinc-100">
                    {item.action} · {item.resource}
                  </p>
                  <p className="mt-1 text-zinc-500">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
