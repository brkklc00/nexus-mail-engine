"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pause, Play, Rocket, SquareX } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

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
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function action(id: string, kind: "start" | "pause" | "resume" | "cancel") {
    setPending(`${id}:${kind}`);
    try {
      const response = await fetch(`/api/campaigns/${id}/${kind}`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `${kind} failed`);
      }
      setMessage(`Campaign ${kind} action completed`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${kind} failed`);
    } finally {
      setPending(null);
      window.setTimeout(() => setMessage(null), 2000);
    }
  }

  function toneForStatus(status: string): "success" | "danger" | "warning" | "info" | "muted" {
    if (status === "running" || status === "completed") return "success";
    if (status === "failed" || status === "canceled") return "danger";
    if (status === "paused" || status === "queued") return "warning";
    return "muted";
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      {message ? (
        <div className="border-b border-border bg-zinc-900/70 px-3 py-2 text-xs text-zinc-300">{message}</div>
      ) : null}
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
            <tr key={row.id} className="border-t border-border text-zinc-200 transition hover:bg-zinc-900/40">
              <td className="px-3 py-2">
                <Link href={`/campaigns/${row.id}`} className="hover:text-white">
                  {row.name}
                </Link>
              </td>
              <td className="px-3 py-2">
                <StatusBadge label={row.status} tone={toneForStatus(row.status)} />
              </td>
              <td className="px-3 py-2">{row.totalTargeted}</td>
              <td className="px-3 py-2">{row.totalSent}</td>
              <td className="px-3 py-2">{row.totalFailed}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1">
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => void action(row.id, "start")}
                    disabled={pending !== null}
                  >
                    {pending === `${row.id}:start` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                    Start
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => void action(row.id, "pause")}
                    disabled={pending !== null}
                  >
                    <Pause className="h-3 w-3" />
                    Pause
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => void action(row.id, "resume")}
                    disabled={pending !== null}
                  >
                    <Play className="h-3 w-3" />
                    Resume
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-red-500 px-2 py-1 text-xs text-red-300 disabled:opacity-50"
                    onClick={() => void action(row.id, "cancel")}
                    disabled={pending !== null}
                  >
                    <SquareX className="h-3 w-3" />
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
