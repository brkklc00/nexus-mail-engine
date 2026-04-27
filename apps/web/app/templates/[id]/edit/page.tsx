type TemplateEditPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  const { id } = await params;
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-sm text-zinc-300">
      Template editing flow moved to the `Templates` page manager panel. Template ID: {id}
    </div>
  );
}
