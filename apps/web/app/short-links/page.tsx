import { Link2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ShortLinksManager } from "@/components/short-links/short-links-manager";

export const dynamic = "force-dynamic";

export default function ShortLinksPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Kisa Linkler"
        description="Kisa URL'leri, link tiklamalarini ve hizli kampanya linki olusturmayi yonetin."
        action={
          <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">
            <Link2 className="h-4 w-4" />
            nxusurl entegrasyonu
          </span>
        }
      />
      <ShortLinksManager />
    </div>
  );
}

