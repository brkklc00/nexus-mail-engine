import { PageHeader } from "@/components/ui/page-header";
import { SegmentsManager } from "@/components/segments/segments-manager";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Segmentler"
        description="Hedef kitle analizi, dinamik segment olusturma, CSV disa aktarma ve kampanya hedefleme merkezi."
      />
      <SegmentsManager />
    </div>
  );
}
