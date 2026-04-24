import { prisma } from "@nexus/db";

type ListDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ListDetailPage({ params }: ListDetailPageProps) {
  const { id } = await params;
  const list = await prisma.recipientList.findUnique({
    where: { id },
    include: {
      memberships: {
        take: 100,
        orderBy: { createdAt: "desc" },
        include: {
          recipient: true
        }
      }
    }
  });

  if (!list) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-zinc-300">List not found.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-gradient-to-r from-card to-zinc-900 p-5">
        <h2 className="text-xl font-semibold text-white">{list.name}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {list.memberships.length} recipients loaded · max {list.maxSize}
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Added</th>
            </tr>
          </thead>
          <tbody>
            {list.memberships.map((membership: any) => (
              <tr key={membership.id} className="border-b border-border/70 text-zinc-200">
                <td className="px-4 py-3 font-medium text-white">{membership.recipient.email}</td>
                <td className="px-4 py-3">{membership.recipient.name ?? "-"}</td>
                <td className="px-4 py-3">{membership.recipient.status}</td>
                <td className="px-4 py-3 text-zinc-400">{new Date(membership.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
