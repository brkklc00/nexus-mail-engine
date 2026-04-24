"use client";

import { useState } from "react";
import { PlusCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type Entry = {
  id: string;
  email: string;
  scope: string;
  reason: string;
  source: string | null;
  createdAt: string;
};

export function SuppressionManager({ initialEntries }: { initialEntries: Entry[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [entries, setEntries] = useState(initialEntries);
  const [manual, setManual] = useState({ email: "", reason: "manual_add", source: "admin-ui" });
  const [bulkText, setBulkText] = useState("");

  async function addManual() {
    const response = await fetch("/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manual)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; entry?: Entry };
    if (!response.ok || !payload.ok || !payload.entry) {
      toast.error("Suppression eklenemedi", payload.error ?? "İşlem başarısız.");
      return;
    }
    setEntries((prev) => [payload.entry!, ...prev]);
    setManual((prev) => ({ ...prev, email: "" }));
    toast.success("Suppression kaydı eklendi");
    router.refresh();
  }

  async function addBulk() {
    const emails = bulkText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!emails.length) return;
    const accepted = await confirm({
      title: "Bulk suppression import yapılsın mı?",
      message: `${emails.length} e-posta suppression listesine eklenecek.`,
      confirmLabel: "Import et",
      cancelLabel: "Vazgeç",
      tone: "warning"
    });
    if (!accepted) return;
    const response = await fetch("/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emails,
        reason: manual.reason,
        source: manual.source
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; inserted?: number };
    if (!response.ok || !payload.ok) {
      toast.error("Bulk import başarısız", payload.error ?? "Veriyi kontrol edin.");
      return;
    }
    toast.success("Bulk import tamamlandı", `Eklenen kayıt: ${payload.inserted ?? emails.length}`);
    setBulkText("");
    router.refresh();
  }

  async function removeEntry(id: string) {
    const accepted = await confirm({
      title: "Suppression kaydı kaldırılsın mı?",
      message: "Bu alıcı tekrar gönderim kapsamına girebilir.",
      confirmLabel: "Kaldır",
      cancelLabel: "Vazgeç",
      tone: "danger"
    });
    if (!accepted) return;
    const response = await fetch(`/api/suppressions/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Suppression kaldırılamadı", payload.error ?? "İşlem başarısız.");
      return;
    }
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    toast.info("Suppression kaydı kaldırıldı");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Manual Add</p>
          <div className="mt-2 space-y-2">
            <input
              placeholder="email@example.com"
              value={manual.email}
              onChange={(e) => setManual((s) => ({ ...s, email: e.target.value }))}
              className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            />
            <input
              placeholder="Reason"
              value={manual.reason}
              onChange={(e) => setManual((s) => ({ ...s, reason: e.target.value }))}
              className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => void addManual()} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm text-white">
              <PlusCircle className="h-4 w-4" />
              Add
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Bulk Import</p>
          <textarea
            rows={4}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="one email per line"
            className="mt-2 w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => void addBulk()} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-zinc-200">
            <Upload className="h-3.5 w-3.5" />
            Import
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border/70 text-zinc-200">
                <td className="px-4 py-3 font-medium text-white">{entry.email}</td>
                <td className="px-4 py-3">
                  <StatusBadge label={entry.scope} tone={entry.scope === "global" ? "danger" : "warning"} />
                </td>
                <td className="px-4 py-3">{entry.reason}</td>
                <td className="px-4 py-3 text-zinc-400">{entry.source ?? "-"}</td>
                <td className="px-4 py-3 text-zinc-400">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => void removeEntry(entry.id)} className="text-rose-300">
                    <Trash2 className="inline h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
