import { LiveSendPanel } from "@/components/send/live-send-panel";

export default function SendPage() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Send Control</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Campaign oluştur, başlat, duraklat/devam ettir ve canlı metrik akışını takip et.
        </p>
      </div>
      <LiveSendPanel />
    </div>
  );
}
