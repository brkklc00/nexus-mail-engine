import { PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export default function NewTemplatePage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="New Template"
        description="Yeni template olusturma formu. Kaydetme endpoint'i aktif oldugunda direkt kullanima alinacak."
      />
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="grid grid-cols-1 gap-3">
          <input placeholder="Template title" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" />
          <input placeholder="Subject line" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm" />
          <textarea
            rows={10}
            placeholder="<html>...</html>"
            className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled
            className="inline-flex w-fit cursor-not-allowed items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-500"
            title="Create template endpoint henuz bagli degil"
          >
            <PlusCircle className="h-4 w-4" />
            Save Template
          </button>
        </div>
      </div>
    </div>
  );
}
