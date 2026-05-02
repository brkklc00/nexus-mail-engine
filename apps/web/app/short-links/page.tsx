import { Link2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ShortLinksManager } from "@/components/short-links/short-links-manager";

export const dynamic = "force-dynamic";

export default function ShortLinksPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Short Links"
        description="Manage short URLs, link clicks, and quick campaign link generation."
        action={
          <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">
            <Link2 className="h-4 w-4" />
            nxusurl integration
          </span>
        }
      />
      <ShortLinksManager />
    </div>
  );
}

