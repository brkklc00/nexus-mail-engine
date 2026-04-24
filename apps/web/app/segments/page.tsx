import { Filter, PlusCircle } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const segments = await prisma.segment.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { rules: true, campaigns: true } },
      list: { select: { name: true } }
    }
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Segments"
        description="Rule-based hedefleme kurgulari ve bagli kampanya etkisi."
        action={
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-500"
          >
            <PlusCircle className="h-4 w-4" />
            Create Segment
          </button>
        }
      />

      {segments.length === 0 ? (
        <EmptyState
          icon="filter"
          title="Segment tanimlanmamis"
          description="Kural tabanli segment olusturdugunda kampanya hedeflemesi burada yonetilecek."
          ctaLabel="Create first segment"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {segments.map((segment: any) => (
            <article key={segment.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{segment.name}</h3>
                  <p className="mt-1 text-xs text-zinc-400">{segment.description ?? "No description"}</p>
                </div>
                <StatusBadge
                  label={`${segment._count.rules} rules`}
                  tone={segment._count.rules > 0 ? "success" : "warning"}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Stat label="List" value={segment.list?.name ?? "Global"} />
                <Stat label="Rules" value={segment._count.rules} />
                <Stat label="Campaigns" value={segment._count.campaigns} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-zinc-900/60 p-2 text-zinc-300">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="truncate pt-1 text-xs font-medium text-white">{value}</p>
    </div>
  );
}
