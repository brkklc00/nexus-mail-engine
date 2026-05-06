import { PageHeader } from "@/components/ui/page-header";
import { LogsViewer } from "@/components/logs/logs-viewer";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Operasyon Kayitlari"
        description="Sayfalanmis, filtrelenebilir ve detay pencereli uretim kayit goruntuleme ekrani."
      />
      <LogsViewer />
    </div>
  );
}
