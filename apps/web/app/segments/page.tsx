import { PageHeader } from "@/components/ui/page-header";
import { SegmentsManager } from "@/components/segments/segments-manager";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Segments"
        description="Audience analytics, dynamic segment builder, CSV export ve campaign targeting merkezi."
      />
      <SegmentsManager />
    </div>
  );
}
