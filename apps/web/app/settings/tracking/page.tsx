import { getShortenerStatus } from "@/server/short-links/nxusurl.service";

export default function TrackingSettingsPage() {
  const shortener = getShortenerStatus();
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-semibold text-white">Takip Ayarlari</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Acma/tiklama secenekleri, token suresi ve gizlilik odakli etkinlik ayarlari.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-white">Shortener API Durumu</h3>
        <div className="mt-3 grid gap-2 text-sm text-zinc-300 md:grid-cols-2">
          <p>Durum: {shortener.configured ? "bagli" : "yapilandirilmamis"}</p>
          <p>API anahtari: {shortener.configured ? "var" : "yok"}</p>
          <p className="md:col-span-2">Base URL: {shortener.baseUrl || "yapilandirilmamis"}</p>
          <p>Son senkronizasyon: -</p>
        </div>
      </div>
    </div>
  );
}
