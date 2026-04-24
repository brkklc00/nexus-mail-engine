type TemplateEditPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TemplateEditPage({ params }: TemplateEditPageProps) {
  const { id } = await params;
  const { prisma } = await import("@nexus/db");
  const template = await prisma.mailTemplate.findUnique({ where: { id } });

  if (!template) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-zinc-300">
        Template not found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-gradient-to-r from-card to-zinc-900 p-5">
        <h2 className="text-xl font-semibold text-white">Edit Template</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {template.title} · version {template.version} · status {template.status}
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="grid grid-cols-1 gap-3">
          <input defaultValue={template.title} className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" />
          <input defaultValue={template.subject} className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" />
          <textarea
            rows={10}
            defaultValue={template.htmlBody}
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled
            className="w-fit cursor-not-allowed rounded-lg border border-border px-3 py-2 text-sm text-zinc-500"
            title="Template update endpoint henuz bagli degil"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
