import { Activity, Search } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function LogsPage({
  searchParams
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const q = params.q?.trim() ?? "";

  const [campaignLogs, auditLogs] = await Promise.all([
    prisma.campaignLog.findMany({
      where: q
        ? {
            OR: [
              { eventType: { contains: q, mode: "insensitive" } },
              { message: { contains: q, mode: "insensitive" } }
            ]
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 60
    }),
    prisma.auditLog.findMany({
      where: q
        ? {
            OR: [
              { action: { contains: q, mode: "insensitive" } },
              { resource: { contains: q, mode: "insensitive" } }
            ]
          }
        : undefined,
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
      </form>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-200">Campaign Logs</h3>
          {campaignLogs.length === 0 ? (
            <EmptyState
              icon={Activity}
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
              icon={Activity}
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
