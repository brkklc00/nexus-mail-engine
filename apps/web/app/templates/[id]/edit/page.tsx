type TemplateEditPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  const { id } = await params;
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-white">Edit Template {id}</h2>
      <p className="mt-2 text-sm text-zinc-400">Versioned template editing and test send panel scaffold.</p>
    </div>
  );
}
