import { MailPlus } from "lucide-react";
import { prisma } from "@nexus/db";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TemplatesManager } from "@/components/templates/templates-manager";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const [templates, smtps] = await Promise.all([
    prisma.mailTemplate.findMany({
      include: {
        _count: { select: { campaigns: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 100
    }),
    prisma.smtpAccount.findMany({
      where: { isActive: true, isSoftDeleted: false },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" }
    })
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Templates"
        description="Template listesi, versiyon bilgisi ve edit aksiyonlari."
        action={<span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-300"><MailPlus className="h-4 w-4" />Manage templates</span>}
      />

      {templates.length === 0 ? (
        <EmptyState
          icon="mail-plus"
          title="Henuz template yok"
          description="Asagidaki form ile ilk template'i olusturabilirsin."
        />
      ) : null}
      <TemplatesManager
        initialTemplates={templates.map((template: any) => ({
          id: template.id,
          title: template.title,
          subject: template.subject,
          htmlBody: template.htmlBody,
          plainTextBody: template.plainTextBody,
          version: template.version,
          status: template.status,
          updatedAt: template.updatedAt.toISOString(),
          campaignCount: template._count.campaigns
        }))}
        smtpOptions={smtps}
      />
    </div>
  );
}
