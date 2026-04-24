type TemplateEditPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  const { id } = await params;
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-sm text-zinc-300">
      Template düzenleme akisi `Templates` sayfasindaki manager paneline tasindi. Template ID: {id}
    </div>
  );
}
