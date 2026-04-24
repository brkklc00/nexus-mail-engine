import { Ban, PlusCircle, Search } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function SuppressionPage({
  searchParams
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const q = params.q?.trim() ?? "";

  const entries = await prisma.suppressionEntry.findMany({
    where: q
      ? {
          OR: [
            { emailNormalized: { contains: q.toLowerCase() } },
            { reason: { contains: q, mode: "insensitive" } }
          ]
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppression"
        description="Global ve list bazli suppression kayitlari."
        action={
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-500"
          >
            <PlusCircle className="h-4 w-4" />
            Add Entry
          </button>
        }
      />

      <form className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search email or reason..."
          className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </form>

      {entries.length === 0 ? (
        <EmptyState
          icon="ban"
          title={q ? "Arama sonucu yok" : "Suppression kaydi yok"}
          description={
            q
              ? "Farkli bir e-posta veya reason ile tekrar deneyin."
              : "Suppression kayitlari olustugunda veya manuel eklendiginde burada listelenecek."
          }
          ctaLabel="Manual add"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: any) => (
                <tr key={entry.id} className="border-b border-border/70 text-zinc-200">
                  <td className="px-4 py-3 font-medium text-white">{entry.email}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={entry.scope} tone={entry.scope === "global" ? "danger" : "warning"} />
                  </td>
                  <td className="px-4 py-3">{entry.reason}</td>
                  <td className="px-4 py-3 text-zinc-400">{entry.source ?? "-"}</td>
                  <td className="px-4 py-3 text-zinc-400">{new Date(entry.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
