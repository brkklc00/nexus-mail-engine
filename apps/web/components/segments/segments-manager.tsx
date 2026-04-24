"use client";

import { useState } from "react";
import { PlusCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/notification-provider";

type ListOption = { id: string; name: string };

export function SegmentsManager({ lists }: { lists: ListOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    name: "",
    description: "",
    listId: "",
    includeTag: "",
    excludeTag: ""
  });
  async function createSegment() {
    const response = await fetch("/api/segments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        listId: form.listId || undefined,
        includeTag: form.includeTag || undefined,
        excludeTag: form.excludeTag || undefined
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (response.ok && payload.ok) {
      toast.success("Segment oluşturuldu");
      setForm({ name: "", description: "", listId: "", includeTag: "", excludeTag: "" });
      router.refresh();
      return;
    }
    toast.error("Segment oluşturulamadı", payload.error ?? "İşlem başarısız.");
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-zinc-200">Create Segment</h3>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <input
          className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          placeholder="Segment name"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
        />
        <select
          className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          value={form.listId}
          onChange={(e) => setForm((s) => ({ ...s, listId: e.target.value }))}
        >
          <option value="">Global list scope</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm md:col-span-2"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
        />
        <input
          className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          placeholder="Include tag (optional)"
          value={form.includeTag}
          onChange={(e) => setForm((s) => ({ ...s, includeTag: e.target.value }))}
        />
        <input
          className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          placeholder="Exclude tag (optional)"
          value={form.excludeTag}
          onChange={(e) => setForm((s) => ({ ...s, excludeTag: e.target.value }))}
        />
      </div>
      <button
        type="button"
        onClick={() => void createSegment()}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white"
      >
        <PlusCircle className="h-4 w-4" />
        Save Segment
      </button>
    </div>
  );
}
