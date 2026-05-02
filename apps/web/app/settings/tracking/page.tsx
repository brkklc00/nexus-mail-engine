import { getShortenerStatus } from "@/server/short-links/nxusurl.service";

export default function TrackingSettingsPage() {
  const shortener = getShortenerStatus();
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-semibold text-white">Tracking Settings</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Open/click toggles, token expiry and privacy-friendly event settings.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-white">Shortener API Status</h3>
        <div className="mt-3 grid gap-2 text-sm text-zinc-300 md:grid-cols-2">
          <p>Status: {shortener.configured ? "connected" : "not configured"}</p>
          <p>API key present: {shortener.configured ? "yes" : "no"}</p>
          <p className="md:col-span-2">Base URL: {shortener.baseUrl || "not configured"}</p>
          <p>Last sync: -</p>
        </div>
      </div>
    </div>
  );
}
