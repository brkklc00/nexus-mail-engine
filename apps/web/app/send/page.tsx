import { LiveSendPanel } from "@/components/send/live-send-panel";
import { PageHeader } from "@/components/ui/page-header";

export default function SendPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Send Control"
        description="Create campaigns, start delivery, monitor live progress, and control actions from one panel."
      />
      <div className="rounded-2xl border border-border bg-card p-5">
        <LiveSendPanel />
      </div>
    </div>
  );
}
