"use client";

import { useMemo, useState } from "react";
import { Download, PlusCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type ListItem = {
  id: string;
  name: string;
  maxSize: number;
  tags: string[];
  count: number;
  createdAt: string;
};

type Membership = {
  id: string;
  createdAt: string;
  recipient: {
    id: string;
    email: string;
    name: string | null;
    status: string;
  };
};

export function ListsManager({ initialLists }: { initialLists: ListItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [lists, setLists] = useState(initialLists);
  const [selectedId, setSelectedId] = useState(initialLists[0]?.id ?? "");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [listForm, setListForm] = useState({ name: "", maxSize: 500 });
  const [manualEmail, setManualEmail] = useState("");
  const [bulkText, setBulkText] = useState("");
  const selected = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId]);

  async function loadList(id: string) {
    setSelectedId(id);
    setLoadingMembers(true);
    const response = await fetch(`/api/lists/${id}`);
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      list?: { memberships: Membership[] };
    };
    if (!response.ok || !payload.ok) {
      toast.error("Liste yüklenemedi", payload.error ?? "Detaylar alınamadı.");
      setLoadingMembers(false);
      return;
    }
    setMemberships(payload.list?.memberships ?? []);
    setLoadingMembers(false);
  }

  async function createList() {
    const response = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(listForm)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; list?: any };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("Liste oluşturulamadı", payload.error ?? "İşlem başarısız.");
      return;
    }
    const next: ListItem = {
      id: payload.list.id,
      name: payload.list.name,
      maxSize: payload.list.maxSize,
      tags: payload.list.tags ?? [],
      count: 0,
      createdAt: payload.list.createdAt
    };
    setLists((prev) => [next, ...prev]);
    setListForm({ name: "", maxSize: 500 });
    toast.success("Liste oluşturuldu");
    await loadList(next.id);
    router.refresh();
  }

  async function updateList() {
    if (!selected) return;
    const response = await fetch(`/api/lists/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selected.name, maxSize: selected.maxSize })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; list?: any };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("Liste güncellenemedi", payload.error ?? "İşlem başarısız.");
      return;
    }
    setLists((prev) =>
      prev.map((item) =>
        item.id === selected.id
          ? { ...item, name: payload.list.name, maxSize: payload.list.maxSize, tags: payload.list.tags ?? item.tags }
          : item
      )
    );
    toast.success("Liste güncellendi");
    router.refresh();
  }

  async function deleteList() {
    if (!selected) return;
    const accepted = await confirm({
      title: "Liste silinsin mi?",
      message: `"${selected.name}" silinecek ve bağlı segmentler kaldırılacak.`,
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      tone: "danger"
    });
    if (!accepted) return;
    const response = await fetch(`/api/lists/${selected.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Liste silinemedi", payload.error ?? "İşlem başarısız.");
      return;
    }
    const next = lists.filter((list) => list.id !== selected.id);
    setLists(next);
    setSelectedId(next[0]?.id ?? "");
    setMemberships([]);
    toast.success("Liste silindi");
    router.refresh();
  }

  async function addManualRecipient() {
    if (!selected || !manualEmail.trim()) return;
    const response = await fetch(`/api/lists/${selected.id}/recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "single", email: manualEmail.trim() })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Alıcı eklenemedi", payload.error ?? "E-posta formatını kontrol edin.");
      return;
    }
    setManualEmail("");
    toast.success("Alıcı eklendi");
    await loadList(selected.id);
    router.refresh();
  }

  async function removeRecipient(recipientId: string) {
    if (!selected) return;
    const accepted = await confirm({
      title: "Alıcı listeden çıkarılsın mı?",
      message: "Bu işlem yalnızca mevcut listeden üyeliği kaldırır.",
      confirmLabel: "Kaldır",
      cancelLabel: "Vazgeç",
      tone: "warning"
    });
    if (!accepted) return;
    const response = await fetch(`/api/lists/${selected.id}/recipients`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Alıcı kaldırılamadı", payload.error ?? "İşlem başarısız.");
      return;
    }
    toast.info("Alıcı listeden kaldırıldı");
    await loadList(selected.id);
    router.refresh();
  }

  async function importBulk() {
    if (!selected || !bulkText.trim()) return;
    if (memberships.length > 0) {
      const accepted = await confirm({
        title: "Bulk import mevcut listeye eklensin mi?",
        message: "Mevcut üyeler korunur, duplicate satırlar atlanır.",
        confirmLabel: "Import et",
        cancelLabel: "Vazgeç",
        tone: "warning"
      });
      if (!accepted) return;
    }
    const response = await fetch(`/api/lists/${selected.id}/recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "bulk", csvText: bulkText })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      insertedCount?: number;
      invalidCount?: number;
      duplicateCount?: number;
    };
    if (!response.ok || !payload.ok) {
      toast.error("Import başarısız", payload.error ?? "CSV verisini kontrol edin.");
      return;
    }
    setBulkText("");
    toast.success(
      "Import tamamlandı",
      `Import complete: +${payload.insertedCount ?? 0}, invalid ${payload.invalidCount ?? 0}, duplicate ${
        payload.duplicateCount ?? 0
      }`
    );
    await loadList(selected.id);
    router.refresh();
  }

  async function dedupe() {
    if (!selected) return;
    const accepted = await confirm({
      title: "Liste deduplicate edilsin mi?",
      message: "Aynı normalize e-postaya sahip tekrarlar kaldırılacak.",
      confirmLabel: "Dedupe uygula",
      cancelLabel: "Vazgeç",
      tone: "warning"
    });
    if (!accepted) return;
    const response = await fetch(`/api/lists/${selected.id}/dedupe`, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; removed?: number };
    if (!response.ok || !payload.ok) {
      toast.error("Dedupe başarısız", payload.error ?? "İşlem başarısız.");
      return;
    }
    toast.info("Dedupe tamamlandı", `Kaldırılan kayıt: ${payload.removed ?? 0}`);
    await loadList(selected.id);
    router.refresh();
  }

  async function exportCsv() {
    if (!selected) return;
    const response = await fetch(`/api/lists/${selected.id}/export`);
    if (!response.ok) {
      toast.error("Export başarısız");
      return;
    }
    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `list-${selected.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV export tamamlandı");
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-zinc-200">Create List</h3>
        <div className="mt-3 space-y-2">
          <input
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            placeholder="List name"
            value={listForm.name}
            onChange={(e) => setListForm((s) => ({ ...s, name: e.target.value }))}
          />
          <input
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            placeholder="Max size"
            type="number"
            value={listForm.maxSize}
            onChange={(e) => setListForm((s) => ({ ...s, maxSize: Number(e.target.value) || 500 }))}
          />
          <button
            type="button"
            onClick={() => void createList()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white"
          >
            <PlusCircle className="h-4 w-4" />
            Add list
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => void loadList(list.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  selectedId === list.id ? "border-indigo-400/40 bg-indigo-500/10" : "border-border bg-zinc-900/40"
                }`}
              >
                <p className="text-sm font-medium text-white">{list.name}</p>
                <p className="text-xs text-zinc-400">{list.count.toLocaleString()} recipients</p>
              </button>
            ))}
          </div>

          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                    value={selected.name}
                    onChange={(e) =>
                      setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, name: e.target.value } : item)))
                    }
                  />
                  <StatusBadge label={`${selected.count} members`} tone="info" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void updateList()} className="rounded-lg border border-border px-2.5 py-1.5 text-xs">
                    Update
                  </button>
                  <button type="button" onClick={() => void deleteList()} className="rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-xs text-rose-300">
                    Delete
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void dedupe()} className="rounded-lg border border-border px-3 py-2 text-xs">
                  Deduplicate
                </button>
                <button type="button" onClick={() => void exportCsv()} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs">
                  <Download className="h-3.5 w-3.5" />
                  Export
                </button>
              </div>

              <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Manual Add Recipient</p>
                <div className="mt-2 flex gap-2">
                  <input
                    placeholder="email@example.com"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                  />
                  <button type="button" onClick={() => void addManualRecipient()} className="rounded-lg bg-accent px-3 py-2 text-sm text-white">
                    Add
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Bulk Import CSV</p>
                <p className="mt-1 text-[11px] text-zinc-500">Format: email,firstName,lastName</p>
                <textarea
                  rows={4}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void importBulk()}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-zinc-200"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import
                </button>
              </div>

              <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Recipients</p>
                {loadingMembers ? (
                  <p className="text-xs text-zinc-500">Loading...</p>
                ) : memberships.length === 0 ? (
                  <p className="text-xs text-zinc-500">No recipients in this list.</p>
                ) : (
                  <div className="space-y-1">
                    {memberships.map((membership) => (
                      <div key={membership.id} className="flex items-center justify-between rounded-lg border border-border bg-zinc-900/70 px-2 py-1.5 text-xs">
                        <div>
                          <p className="text-zinc-200">{membership.recipient.email}</p>
                          <p className="text-zinc-500">{membership.recipient.status}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeRecipient(membership.recipient.id)}
                          className="text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-zinc-900/60 p-4 text-sm text-zinc-400">No list selected.</div>
          )}
        </div>
      </section>
    </div>
  );
}
