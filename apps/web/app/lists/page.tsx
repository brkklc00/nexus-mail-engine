import Link from "next/link";
import { Download, FolderPlus, Upload } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const lists = await prisma.recipientList.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { memberships: true }
      }
    }
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recipient Lists"
        description="Liste bazli hacim, uye sayisi ve import/export aksiyonlari."
        action={
          <div className="flex gap-2">
            <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-500">
              <Upload className="h-4 w-4" />
              Import
            </button>
            <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-500">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        }
      />

      {lists.length === 0 ? (
        <EmptyState
          icon="folder-plus"
          title="Liste yok"
          description="Import islemi ile alici listelerini sisteme ekleyebilirsin."
          ctaLabel="Import recipients"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr className="border-b border-border bg-zinc-900/60">
                <th className="px-4 py-3">List</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3">Limit</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((list: any) => (
                <tr key={list.id} className="border-b border-border/70 text-zinc-200 transition hover:bg-zinc-900/40">
                  <td className="px-4 py-3">
                    <Link href={`/lists/${list.id}`} className="font-medium text-white hover:text-indigo-200">
                      {list.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{list._count.memberships.toLocaleString()}</td>
                  <td className="px-4 py-3">{list.maxSize.toLocaleString()}</td>
                  <td className="px-4 py-3 text-zinc-400">{new Date(list.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={list._count.memberships === 0 ? "empty" : "ready"}
                      tone={list._count.memberships === 0 ? "warning" : "success"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
