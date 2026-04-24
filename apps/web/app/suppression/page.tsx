import { Ban, Search } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SuppressionManager } from "@/components/suppression/suppression-manager";

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
        action={<span className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">Manage suppression</span>}
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
              : "Asagidaki panelden manuel veya bulk suppression ekleyebilirsin."
          }
        />
      ) : null}
      <SuppressionManager
        initialEntries={entries.map((entry: any) => ({
          id: entry.id,
          email: entry.email,
          scope: entry.scope,
          reason: entry.reason,
          source: entry.source,
          createdAt: entry.createdAt.toISOString()
        }))}
      />
    </div>
  );
}
