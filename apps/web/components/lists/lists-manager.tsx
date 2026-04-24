"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Download, Loader2, PlusCircle, Search, ShieldMinus, Sparkles, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type ListSummary = {
  totalRecipients: number;
  validCount: number;
  invalidCount: number;
  duplicateSkippedCount: number;
  suppressedCount: number;
  lastImportDate: string | null;
};

type ListItem = {
  id: string;
  name: string;
  notes: string | null;
  tags: string[];
  maxSize: number;
  summary: ListSummary;
  createdAt: string;
};

type SearchRow = {
  membershipId: string;
  recipientId: string;
  email: string;
  emailNormalized: string;
  name: string | null;
  status: string;
  updatedAt: string;
};

type SearchPayload = {
  query: string;
  page: number;
  pageSize: number;
  totalMatches: number;
  rows: SearchRow[];
};

type ActionState =
  | "create"
  | "update"
  | "delete"
  | "import"
  | "bulkRemove"
  | "validate"
  | "dedupe"
  | "removeInvalid"
  | "removeSuppressed"
  | "clear"
  | "exportValid"
  | "exportInvalid"
  | "search"
  | null;

const EMPTY_SUMMARY: ListSummary = {
  totalRecipients: 0,
  validCount: 0,
  invalidCount: 0,
  duplicateSkippedCount: 0,
  suppressedCount: 0,
  lastImportDate: null
};

export function ListsManager({ initialLists }: { initialLists: ListItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [lists, setLists] = useState(initialLists);
  const [selectedId, setSelectedId] = useState(initialLists[0]?.id ?? "");
  const [selectedSummary, setSelectedSummary] = useState<ListSummary>(initialLists[0]?.summary ?? EMPTY_SUMMARY);
  const [searchPayload, setSearchPayload] = useState<SearchPayload>({
    query: "",
    page: 1,
    pageSize: 50,
    totalMatches: 0,
    rows: []
  });
  const [actionState, setActionState] = useState<ActionState>(null);

  const [listForm, setListForm] = useState({
    name: "",
    notes: "",
    tags: "",
    capacityLimit: ""
  });
  const [importForm, setImportForm] = useState({
    text: "",
    dedupeGlobally: false
  });
  const [removeForm, setRemoveForm] = useState({
    text: "",
    removeFromAllLists: false,
    addToSuppression: false
  });
  const [searchQuery, setSearchQuery] = useState("");

  const selected = useMemo(() => lists.find((item) => item.id === selectedId) ?? null, [lists, selectedId]);

  async function fetchListSummary(id: string) {
    const response = await fetch(`/api/lists/${id}`);
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      list?: { summary: ListSummary };
    };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("Liste özeti alınamadı", payload.error ?? "İşlem başarısız.");
      return null;
    }
    return payload.list.summary;
  }

  async function selectList(id: string) {
    setSelectedId(id);
    setSearchPayload({ query: "", page: 1, pageSize: 50, totalMatches: 0, rows: [] });
    setSearchQuery("");
    const summary = await fetchListSummary(id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === id ? { ...item, summary } : item)));
    }
  }

  async function createList() {
    setActionState("create");
    const response = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: listForm.name,
        notes: listForm.notes || undefined,
        tags: listForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        maxSize: listForm.capacityLimit ? Number(listForm.capacityLimit) : undefined
      })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      list?: { id: string; name: string; notes: string | null; tags: string[]; maxSize: number; createdAt: string };
    };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("Liste oluşturulamadı", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }

    const nextList: ListItem = {
      id: payload.list.id,
      name: payload.list.name,
      notes: payload.list.notes,
      tags: payload.list.tags ?? [],
      maxSize: payload.list.maxSize,
      summary: EMPTY_SUMMARY,
      createdAt: payload.list.createdAt
    };
    setLists((prev) => [nextList, ...prev]);
    setListForm({ name: "", notes: "", tags: "", capacityLimit: "" });
    toast.success("Liste oluşturuldu");
    setActionState(null);
    await selectList(nextList.id);
    router.refresh();
  }

  async function updateList() {
    if (!selected) return;
    setActionState("update");
    const response = await fetch(`/api/lists/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: selected.name,
        notes: selected.notes,
        tags: selected.tags,
        maxSize: selected.maxSize
      })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      list?: { name: string; notes: string | null; tags: string[]; maxSize: number };
    };
    if (!response.ok || !payload.ok || !payload.list) {
      toast.error("Liste güncellenemedi", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }
    setLists((prev) =>
      prev.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              name: payload.list!.name,
              notes: payload.list!.notes,
              tags: payload.list!.tags,
              maxSize: payload.list!.maxSize
            }
          : item
      )
    );
    toast.success("Liste güncellendi");
    setActionState(null);
    router.refresh();
  }

  async function deleteList() {
    if (!selected) return;
    const accepted = await confirm({
      title: "Liste silinsin mi?",
      message: `"${selected.name}" listesi ve üyelikleri kaldırılacak.`,
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      tone: "danger"
    });
    if (!accepted) return;

    setActionState("delete");
    const response = await fetch(`/api/lists/${selected.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Liste silinemedi", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }

    const next = lists.filter((item) => item.id !== selected.id);
    setLists(next);
    setSelectedId(next[0]?.id ?? "");
    setSelectedSummary(next[0]?.summary ?? EMPTY_SUMMARY);
    setActionState(null);
    toast.success("Liste silindi");
    router.refresh();
  }

  async function importBulk() {
    if (!selected || !importForm.text.trim()) return;
    setActionState("import");
    const response = await fetch(`/api/lists/${selected.id}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(importForm)
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      result?: {
        totalProcessed: number;
        added: number;
        duplicateSkipped: number;
        invalidSkipped: number;
        alreadySuppressedSkipped: number;
        alreadyInListSkipped: number;
        alreadyInOtherListsSkipped: number;
        capacitySkipped: number;
      };
    };
    if (!response.ok || !payload.ok || !payload.result) {
      toast.error("Bulk import başarısız", payload.error ?? "Veri işlenemedi.");
      setActionState(null);
      return;
    }
    setImportForm((prev) => ({ ...prev, text: "" }));
    toast.success(
      "Import tamamlandı",
      `Processed ${payload.result.totalProcessed}, added ${payload.result.added}, duplicate ${payload.result.duplicateSkipped}, invalid ${payload.result.invalidSkipped}, suppressed ${payload.result.alreadySuppressedSkipped}, capacity skipped ${payload.result.capacitySkipped}`
    );
    const summary = await fetchListSummary(selected.id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, summary } : item)));
    }
    setActionState(null);
    router.refresh();
  }

  async function bulkRemove() {
    if (!selected || !removeForm.text.trim()) return;
    const accepted = await confirm({
      title: "Bulk remove çalıştırılsın mı?",
      message: removeForm.removeFromAllLists
        ? "E-postalar tüm listelerden kaldırılacak."
        : "E-postalar yalnızca seçili listeden kaldırılacak.",
      confirmLabel: "Uygula",
      cancelLabel: "Vazgeç",
      tone: "warning"
    });
    if (!accepted) return;

    setActionState("bulkRemove");
    const response = await fetch(`/api/lists/${selected.id}/bulk-remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(removeForm)
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      result?: {
        totalProcessed: number;
        recipientMatches: number;
        removedMemberships: number;
        suppressionAdded: number;
      };
    };
    if (!response.ok || !payload.ok || !payload.result) {
      toast.error("Bulk remove başarısız", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }
    setRemoveForm((prev) => ({ ...prev, text: "" }));
    toast.info(
      "Bulk remove tamamlandı",
      `Processed ${payload.result.totalProcessed}, removed memberships ${payload.result.removedMemberships}, suppression added ${payload.result.suppressionAdded}`
    );
    const summary = await fetchListSummary(selected.id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, summary } : item)));
    }
    setActionState(null);
    router.refresh();
  }

  async function runListAction(
    action: "validate" | "dedupe" | "remove_invalid" | "remove_suppressed" | "clear",
    state: ActionState,
    title: string,
    message: string,
    tone: "warning" | "danger" = "warning"
  ) {
    if (!selected) return;
    const accepted = await confirm({
      title,
      message,
      confirmLabel: "Uygula",
      cancelLabel: "Vazgeç",
      tone
    });
    if (!accepted) return;

    setActionState(state);
    const response = await fetch(`/api/lists/${selected.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      result?: Record<string, number>;
    };
    if (!response.ok || !payload.ok) {
      toast.error("Liste aksiyonu başarısız", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }
    toast.success("Liste aksiyonu tamamlandı", JSON.stringify(payload.result ?? {}));
    const summary = await fetchListSummary(selected.id);
    if (summary) {
      setSelectedSummary(summary);
      setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, summary } : item)));
    }
    setActionState(null);
    router.refresh();
  }

  async function exportCsv(status: "valid" | "invalid") {
    if (!selected) return;
    setActionState(status === "valid" ? "exportValid" : "exportInvalid");
    const response = await fetch(`/api/lists/${selected.id}/export?status=${status}`);
    if (!response.ok) {
      toast.error("Export başarısız");
      setActionState(null);
      return;
    }
    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `list-${selected.id}-${status}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`CSV export tamamlandı (${status})`);
    setActionState(null);
  }

  async function searchRecipients(page = 1) {
    if (!selected) return;
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setSearchPayload({ query: "", page: 1, pageSize: 50, totalMatches: 0, rows: [] });
      return;
    }
    setActionState("search");
    const response = await fetch(`/api/lists/${selected.id}/search?q=${encodeURIComponent(query)}&page=${page}`);
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      search?: SearchPayload;
    };
    if (!response.ok || !payload.ok || !payload.search) {
      toast.error("Arama başarısız", payload.error ?? "Arama sonucu alınamadı.");
      setActionState(null);
      return;
    }
    setSearchPayload(payload.search);
    setActionState(null);
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-zinc-200">Create List</h3>
        <div className="mt-3 space-y-2">
          <input
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            placeholder="List name"
            value={listForm.name}
            onChange={(e) => setListForm((s) => ({ ...s, name: e.target.value }))}
          />
          <textarea
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            placeholder="Description (optional)"
            rows={3}
            value={listForm.notes}
            onChange={(e) => setListForm((s) => ({ ...s, notes: e.target.value }))}
          />
          <input
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            placeholder="Tags (comma separated, optional)"
            value={listForm.tags}
            onChange={(e) => setListForm((s) => ({ ...s, tags: e.target.value }))}
          />
          <input
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            placeholder="Capacity limit (optional, max recipients)"
            type="number"
            value={listForm.capacityLimit}
            onChange={(e) => setListForm((s) => ({ ...s, capacityLimit: e.target.value }))}
          />
          <button
            type="button"
            onClick={() => void createList()}
            disabled={actionState !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            {actionState === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            Add list
          </button>
        </div>

        <div className="mt-6 space-y-2">
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => void selectList(list.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left ${
                selectedId === list.id ? "border-indigo-400/40 bg-indigo-500/10" : "border-border bg-zinc-900/40"
              }`}
            >
              <p className="text-sm font-medium text-white">{list.name}</p>
              <p className="text-xs text-zinc-400">{list.summary.totalRecipients.toLocaleString()} recipients</p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <input
                  className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-white"
                  value={selected.name}
                  onChange={(e) =>
                    setLists((prev) => prev.map((item) => (item.id === selected.id ? { ...item, name: e.target.value } : item)))
                  }
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Last import: {selectedSummary.lastImportDate ? new Date(selectedSummary.lastImportDate).toLocaleString() : "never"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void updateList()}
                  disabled={actionState !== null}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
                >
                  {actionState === "update" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null} Update
                </button>
                <button
                  type="button"
                  onClick={() => void deleteList()}
                  disabled={actionState !== null}
                  className="rounded-lg border border-rose-400/40 px-3 py-2 text-xs text-rose-300 disabled:opacity-60"
                >
                  {actionState === "delete" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : <Trash2 className="inline h-3.5 w-3.5" />} Delete
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Total" value={selectedSummary.totalRecipients} />
              <Stat label="Valid" value={selectedSummary.validCount} />
              <Stat label="Invalid" value={selectedSummary.invalidCount} />
              <Stat label="Suppressed" value={selectedSummary.suppressedCount} />
              <Stat label="Dup skipped" value={selectedSummary.duplicateSkippedCount} />
              <Stat label="Capacity" value={selected.maxSize} />
            </div>

            <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Bulk Paste Import</p>
              <p className="mt-1 text-xs text-zinc-500">
                Paste one email per line or mixed text; system will extract valid emails.
              </p>
              <textarea
                rows={6}
                value={importForm.text}
                onChange={(e) => setImportForm((s) => ({ ...s, text: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                placeholder={"john@acme.com\nJane Doe <jane@acme.com>\nfoo@bar.com; bar@foo.com"}
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={importForm.dedupeGlobally}
                  onChange={(e) => setImportForm((s) => ({ ...s, dedupeGlobally: e.target.checked }))}
                />
                Dedupe globally (skip emails already in other lists)
              </label>
              <button
                type="button"
                onClick={() => void importBulk()}
                disabled={actionState !== null}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
              >
                {actionState === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import
              </button>
            </div>

            <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Bulk Remove</p>
              <textarea
                rows={5}
                value={removeForm.text}
                onChange={(e) => setRemoveForm((s) => ({ ...s, text: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                placeholder={"remove@domain.com\nremove2@domain.com"}
              />
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={removeForm.removeFromAllLists}
                    onChange={(e) => setRemoveForm((s) => ({ ...s, removeFromAllLists: e.target.checked }))}
                  />
                  Remove from all lists
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={removeForm.addToSuppression}
                    onChange={(e) => setRemoveForm((s) => ({ ...s, addToSuppression: e.target.checked }))}
                  />
                  Add to suppression while removing
                </label>
              </div>
              <button
                type="button"
                onClick={() => void bulkRemove()}
                disabled={actionState !== null}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-60"
              >
                {actionState === "bulkRemove" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldMinus className="h-4 w-4" />}
                Run bulk remove
              </button>
            </div>

            <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Validation Tools</p>
              <div className="flex flex-wrap gap-2">
                <ActionBtn
                  label="Validate list"
                  loading={actionState === "validate"}
                  onClick={() => void runListAction("validate", "validate", "Liste validate edilsin mi?", "Geçersiz e-postalar invalid olarak işaretlenecek.")}
                />
                <ActionBtn
                  label="Deduplicate list"
                  loading={actionState === "dedupe"}
                  onClick={() => void runListAction("dedupe", "dedupe", "Deduplicate çalışsın mı?", "Tekrarlı üyelik satırları kaldırılacak.")}
                />
                <ActionBtn
                  label="Remove invalid emails"
                  loading={actionState === "removeInvalid"}
                  onClick={() => void runListAction("remove_invalid", "removeInvalid", "Invalid kayıtlar kaldırılsın mı?", "Invalid status alıcı üyelikleri silinecek.")}
                />
                <ActionBtn
                  label="Remove suppressed emails"
                  loading={actionState === "removeSuppressed"}
                  onClick={() =>
                    void runListAction("remove_suppressed", "removeSuppressed", "Suppressed kayıtlar kaldırılsın mı?", "Global/list suppression ile eşleşen üyelikler silinecek.")
                  }
                />
                <ActionBtn
                  label="Clear selected list"
                  loading={actionState === "clear"}
                  danger
                  onClick={() =>
                    void runListAction("clear", "clear", "Liste tamamen temizlensin mi?", "Seçili listedeki tüm üyelikler silinecek.", "danger")
                  }
                />
                <ActionBtn
                  label="Export valid emails"
                  loading={actionState === "exportValid"}
                  icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => void exportCsv("valid")}
                />
                <ActionBtn
                  label="Export invalid emails"
                  loading={actionState === "exportInvalid"}
                  icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => void exportCsv("invalid")}
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[280px] flex-1">
                  <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-zinc-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg border border-border bg-zinc-900/70 py-2 pl-8 pr-3 text-sm"
                    placeholder="Search recipients by email (returns first 50 matches)"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void searchRecipients(1)}
                  disabled={actionState !== null}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
                >
                  {actionState === "search" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null} Search
                </button>
              </div>

              {searchPayload.query ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-zinc-500">
                    {searchPayload.totalMatches.toLocaleString()} match · page {searchPayload.page}
                  </p>
                  {searchPayload.rows.length === 0 ? (
                    <p className="text-xs text-zinc-500">No search results.</p>
                  ) : (
                    searchPayload.rows.map((row) => (
                      <div key={row.membershipId} className="flex items-center justify-between rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-xs">
                        <div>
                          <p className="text-zinc-200">{row.email}</p>
                          <p className="text-zinc-500">{row.name ?? "-"}</p>
                        </div>
                        <StatusBadge label={row.status} tone={row.status === "invalid" ? "danger" : "info"} />
                      </div>
                    ))
                  )}
                  {searchPayload.totalMatches > searchPayload.pageSize ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={searchPayload.page <= 1 || actionState !== null}
                        onClick={() => void searchRecipients(searchPayload.page - 1)}
                        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        disabled={searchPayload.page * searchPayload.pageSize >= searchPayload.totalMatches || actionState !== null}
                        onClick={() => void searchRecipients(searchPayload.page + 1)}
                        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">Default view shows summary only. Use search to inspect up to 50 matches per page.</p>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-border bg-zinc-900/60 p-4 text-sm text-zinc-400">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Select a list to manage bulk operations.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{value.toLocaleString()}</p>
    </div>
  );
}

function ActionBtn({
  label,
  loading,
  onClick,
  icon,
  danger = false
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs ${
        danger ? "border-rose-400/40 text-rose-300" : "border-border text-zinc-200"
      } disabled:opacity-60`}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}
