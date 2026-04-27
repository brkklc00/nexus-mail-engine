import { PageHeader } from "@/components/ui/page-header";
import { LogsViewer } from "@/components/logs/logs-viewer";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Operational Logs"
        description="Paginated, filtrelenebilir ve detay modal destekli production log viewer."
      />
      <LogsViewer />
    </div>
  );
}
