import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ListsManager } from "@/components/lists/lists-manager";

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
        action={<span className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">Manage lists</span>}
      />

      {lists.length === 0 ? (
        <EmptyState
          icon="folder-plus"
          title="Liste yok"
          description="Asagidaki panelden yeni liste olusturabilir veya import yapabilirsin."
        />
      ) : null}
      <ListsManager
        initialLists={lists.map((list: any) => ({
          id: list.id,
          name: list.name,
          notes: list.notes,
          maxSize: list.maxSize,
          tags: list.tags,
          summary: {
            totalRecipients: list._count.memberships,
            validCount: 0,
            invalidCount: 0,
            duplicateSkippedCount: 0,
            suppressedCount: 0,
            lastImportDate: null
          },
          createdAt: list.createdAt.toISOString()
        }))}
      />
    </div>
  );
}
