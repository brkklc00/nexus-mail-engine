import { PageHeader } from "@/components/ui/page-header";
import { UnsubscribeSettingsManager } from "@/components/settings/unsubscribe-settings-manager";

export default function UnsubscribeSettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Abonelikten Cik Sayfasi"
        description="Public abonelikten cik sayfasinin dogrulama, metin ve guvenlik ayarlari."
      />
      <UnsubscribeSettingsManager />
    </div>
  );
}

