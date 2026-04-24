"use client";

import { useMemo, useState } from "react";
import { FlaskConical, Pencil, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type TemplateItem = {
  id: string;
  title: string;
  subject: string;
  htmlBody: string;
  plainTextBody: string | null;
  version: number;
  status: string;
  updatedAt: string;
};

type SmtpOption = { id: string; name: string };

export function TemplatesManager({
  initialTemplates,
  smtpOptions
}: {
  initialTemplates: TemplateItem[];
  smtpOptions: SmtpOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedId, setSelectedId] = useState(initialTemplates[0]?.id ?? "");
  const [form, setForm] = useState({
    title: "",
    subject: "",
    htmlBody: "",
    plainTextBody: ""
  });
  const [testSend, setTestSend] = useState({
    smtpAccountId: smtpOptions[0]?.id ?? "",
    toEmail: ""
  });
  const selected = useMemo(() => templates.find((t) => t.id === selectedId) ?? null, [templates, selectedId]);

  async function createTemplate() {
    const response = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateItem };
    if (!response.ok || !payload.ok || !payload.template) {
      toast.error("Template oluşturulamadı", payload.error ?? "İşlem başarısız.");
      return;
    }
    setTemplates((prev) => [payload.template!, ...prev]);
    setSelectedId(payload.template.id);
    toast.success("Template oluşturuldu");
    router.refresh();
  }

  async function updateTemplate() {
    if (!selected) return;
    const response = await fetch(`/api/templates/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selected.title,
        subject: selected.subject,
        htmlBody: selected.htmlBody,
        plainTextBody: selected.plainTextBody
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateItem };
    if (!response.ok || !payload.ok || !payload.template) {
      toast.error("Template güncellenemedi", payload.error ?? "İşlem başarısız.");
      return;
    }
    setTemplates((prev) => prev.map((t) => (t.id === payload.template!.id ? payload.template! : t)));
    toast.success("Template güncellendi");
    router.refresh();
  }

  async function deleteTemplate() {
    if (!selected) return;
    const accepted = await confirm({
      title: "Template silinsin mi?",
      message: `"${selected.title}" kalıcı olarak silinecek.`,
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      tone: "danger"
    });
    if (!accepted) return;
    const response = await fetch(`/api/templates/${selected.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      toast.error("Template silinemedi", payload.error ?? "İşlem başarısız.");
      return;
    }
    const next = templates.filter((t) => t.id !== selected.id);
    setTemplates(next);
    setSelectedId(next[0]?.id ?? "");
    toast.success("Template silindi");
    router.refresh();
  }

  async function runTestSend() {
    if (!selected) return;
    if (!testSend.toEmail.trim()) {
      toast.warning("Test e-posta adresi gerekli");
      return;
    }
    const response = await fetch(`/api/templates/${selected.id}/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testSend)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (response.ok && payload.ok) {
      toast.success("Test gönderimi başarılı");
      return;
    }
    toast.error("Test gönderimi başarısız", payload.error ?? "SMTP veya alıcı kontrol edin.");
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-zinc-200">Create Template</h3>
        <div className="mt-3 space-y-2">
          <input
            placeholder="Title"
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            value={form.title}
            onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
          />
          <input
            placeholder="Subject"
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            value={form.subject}
            onChange={(e) => setForm((s) => ({ ...s, subject: e.target.value }))}
          />
          <textarea
            rows={5}
            placeholder="HTML body"
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            value={form.htmlBody}
            onChange={(e) => setForm((s) => ({ ...s, htmlBody: e.target.value }))}
          />
          <textarea
            rows={3}
            placeholder="Plain text body"
            className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
            value={form.plainTextBody}
            onChange={(e) => setForm((s) => ({ ...s, plainTextBody: e.target.value }))}
          />
          <button
            type="button"
            onClick={() => void createTemplate()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white"
          >
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-200">Template Library</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelectedId(template.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  selectedId === template.id ? "border-indigo-400/40 bg-indigo-500/10" : "border-border bg-zinc-900/40"
                }`}
              >
                <p className="text-sm font-medium text-white">{template.title}</p>
                <p className="text-xs text-zinc-400">{template.subject}</p>
              </button>
            ))}
          </div>

          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{selected.title}</p>
                  <StatusBadge label={selected.status} tone={selected.status === "active" ? "success" : "muted"} />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void updateTemplate()}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-200"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteTemplate()}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-xs text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>

              <input
                value={selected.title}
                onChange={(e) =>
                  setTemplates((prev) => prev.map((t) => (t.id === selected.id ? { ...t, title: e.target.value } : t)))
                }
                className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              />
              <input
                value={selected.subject}
                onChange={(e) =>
                  setTemplates((prev) => prev.map((t) => (t.id === selected.id ? { ...t, subject: e.target.value } : t)))
                }
                className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              />
              <textarea
                rows={8}
                value={selected.htmlBody}
                onChange={(e) =>
                  setTemplates((prev) => prev.map((t) => (t.id === selected.id ? { ...t, htmlBody: e.target.value } : t)))
                }
                className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              />
              <textarea
                rows={4}
                value={selected.plainTextBody ?? ""}
                onChange={(e) =>
                  setTemplates((prev) =>
                    prev.map((t) => (t.id === selected.id ? { ...t, plainTextBody: e.target.value || null } : t))
                  )
                }
                className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
              />

              <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Test Send</p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <select
                    value={testSend.smtpAccountId}
                    onChange={(e) => setTestSend((s) => ({ ...s, smtpAccountId: e.target.value }))}
                    className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm"
                  >
                    {smtpOptions.map((smtp) => (
                      <option key={smtp.id} value={smtp.id}>
                        {smtp.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="recipient@email.com"
                    value={testSend.toEmail}
                    onChange={(e) => setTestSend((s) => ({ ...s, toEmail: e.target.value }))}
                    className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm md:col-span-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void runTestSend()}
                  disabled={!smtpOptions.length}
                  title={!smtpOptions.length ? "No SMTP account available" : undefined}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-500"
                >
                  <FlaskConical className="h-4 w-4" />
                  Send test mail
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-zinc-900/60 p-4 text-sm text-zinc-400">No template selected</div>
          )}
        </div>
      </section>
    </div>
  );
}
