type ListDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ListDetailPage({ params }: ListDetailPageProps) {
  const { id } = await params;
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-white">List Detail {id}</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Recipient table, search, dedupe summary and selected delete actions.
      </p>
    </div>
  );
}
