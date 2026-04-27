import { PageHeader } from "@/components/ui/page-header";
import { SuppressionManager } from "@/components/suppression/suppression-manager";

export const dynamic = "force-dynamic";

export default async function SuppressionPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppression"
        description="Scalable suppression management center with stats, search-driven listing and sync controls."
        action={<span className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">Manage suppression</span>}
      />
      <SuppressionManager />
    </div>
  );
}
