import { PageHeader } from "@/components/ui/page-header";
import { LogsViewer } from "@/components/logs/logs-viewer";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Operational Logs"
        description="Paginated, filterable production log viewer with details modal."
      />
      <LogsViewer />
    </div>
  );
}
