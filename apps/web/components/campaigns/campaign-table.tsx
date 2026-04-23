"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  totalTargeted: number;
  totalSent: number;
  totalFailed: number;
  createdAt: string;
};

export function CampaignTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();

  async function action(id: string, kind: "start" | "pause" | "resume" | "cancel") {
    await fetch(`/api/campaigns/${id}/${kind}`, { method: "POST" });
    router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
          <tr>
            <th className="px-3 py-2">Campaign</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Targeted</th>
            <th className="px-3 py-2">Sent</th>
            <th className="px-3 py-2">Failed</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((row) => (
            <tr key={row.id} className="border-t border-border text-zinc-200">
              <td className="px-3 py-2">
                <Link href={`/campaigns/${row.id}`} className="hover:text-white">
                  {row.name}
                </Link>
              </td>
              <td className="px-3 py-2">{row.status}</td>
              <td className="px-3 py-2">{row.totalTargeted}</td>
              <td className="px-3 py-2">{row.totalSent}</td>
              <td className="px-3 py-2">{row.totalFailed}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1">
                  <button className="rounded border border-border px-2 py-1 text-xs" onClick={() => void action(row.id, "start")}>
                    Start
                  </button>
                  <button className="rounded border border-border px-2 py-1 text-xs" onClick={() => void action(row.id, "pause")}>
                    Pause
                  </button>
                  <button className="rounded border border-border px-2 py-1 text-xs" onClick={() => void action(row.id, "resume")}>
                    Resume
                  </button>
                  <button className="rounded border border-red-500 px-2 py-1 text-xs text-red-300" onClick={() => void action(row.id, "cancel")}>
                    Cancel
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
