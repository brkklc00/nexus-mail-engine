import { MailPlus } from "lucide-react";
import { prisma } from "@nexus/db";
import { PageHeader } from "@/components/ui/page-header";
import { TemplatesManager } from "@/components/templates/templates-manager";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const smtps = await prisma.smtpAccount.findMany({
      where: { isActive: true, isSoftDeleted: false },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" }
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Templates"
        description="Template listesi, versiyon bilgisi ve edit aksiyonlari."
        action={
          <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">
            <MailPlus className="h-4 w-4" />
            Template library
          </span>
        }
      />
      <TemplatesManager
        smtpOptions={smtps}
      />
    </div>
  );
}
