import Link from "next/link";
import { FlaskConical, MailPlus, Pencil } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await prisma.mailTemplate.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Templates"
        description="Template listesi, versiyon bilgisi ve edit aksiyonlari."
        action={
          <Link href="/templates/new" className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white">
            <MailPlus className="h-4 w-4" />
            New Template
          </Link>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          icon="mail-plus"
          title="Henuz template yok"
          description="Ilk template'i olusturarak kampanya akisina baslayabilirsin."
          ctaLabel="Create template"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr className="border-b border-border bg-zinc-900/60">
                <th className="px-4 py-3">Template</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template: any) => (
                <tr key={template.id} className="border-b border-border/70 text-zinc-200 transition hover:bg-zinc-900/40">
                  <td className="px-4 py-3 font-medium text-white">{template.title}</td>
                  <td className="px-4 py-3 text-zinc-300">{template.subject}</td>
                  <td className="px-4 py-3">v{template.version}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={template.status}
                      tone={template.status === "active" ? "success" : "muted"}
                    />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{new Date(template.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/templates/${template.id}/edit`}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-200 hover:border-indigo-400/40 hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                      <button
                        type="button"
                        disabled
                        className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-500"
                        title="Test send endpoint henuz bagli degil"
                      >
                        <FlaskConical className="h-3.5 w-3.5" />
                        Test Send
                      </button>
                    </div>
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
