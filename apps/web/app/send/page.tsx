import { LiveSendPanel } from "@/components/send/live-send-panel";
import { PageHeader } from "@/components/ui/page-header";

export default function SendPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Gonderim Kontrolu"
        description="Kampanya olusturun, gonderimi baslatin, canli ilerlemeyi izleyin ve tum islemleri tek panelden yonetin."
      />
      <div className="rounded-2xl border border-border bg-card p-5">
        <LiveSendPanel />
      </div>
    </div>
  );
}
