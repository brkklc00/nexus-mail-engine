"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Eye, FlaskConical, Loader2, Pencil, Save, Server, ShieldQuestion, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";

type TemplateStatus = "draft" | "active" | "archived" | "disabled";
type PreviewMode = "desktop" | "mobile";
type ActionState = "create" | "update" | "delete" | "archive" | "status" | "testSend" | "testSmtp" | null;

type TemplateItem = {
  id: string;
  title: string;
  subject: string;
  htmlBody: string;
  plainTextBody: string | null;
  version: number;
  status: string;
  updatedAt: string;
  campaignCount: number;
};

type SmtpOption = { id: string; name: string };

function statusTone(status: string): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "active") return "success";
  if (status === "draft") return "warning";
  if (status === "archived" || status === "disabled") return "muted";
  return "info";
}

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
  const [actionState, setActionState] = useState<ActionState>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [pendingStatus, setPendingStatus] = useState<TemplateStatus>("draft");
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
  const canHardDelete = (selected?.campaignCount ?? 0) === 0;

  async function createTemplate() {
    setActionState("create");
    const response = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateItem };
    if (!response.ok || !payload.ok || !payload.template) {
      toast.error("Template oluşturulamadı", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }
    setTemplates((prev) => [{ ...payload.template!, campaignCount: 0 }, ...prev]);
    setSelectedId(payload.template!.id);
    setForm({ title: "", subject: "", htmlBody: "", plainTextBody: "" });
    toast.success("Template oluşturuldu");
    setActionState(null);
    router.refresh();
  }

  async function updateTemplate() {
    if (!selected) return;
    setActionState("update");
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
      setActionState(null);
      return;
    }
    setTemplates((prev) =>
      prev.map((t) => (t.id === selected.id ? { ...payload.template!, campaignCount: t.campaignCount } : t))
    );
    toast.success("Template güncellendi");
    setActionState(null);
    router.refresh();
  }

  async function changeStatus() {
    if (!selected) return;
    const accepted = await confirm({
      title: "Template status değişsin mi?",
      message: `"${selected.title}" durumu "${pendingStatus}" olarak güncellenecek.`,
      confirmLabel: "Status güncelle",
      cancelLabel: "Vazgeç",
      tone: "info"
    });
    if (!accepted) return;

    setActionState("status");
    const response = await fetch(`/api/templates/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: pendingStatus })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateItem };
    if (!response.ok || !payload.ok || !payload.template) {
      toast.error("Status güncellenemedi", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }
    setTemplates((prev) =>
      prev.map((t) => (t.id === selected.id ? { ...payload.template!, campaignCount: t.campaignCount } : t))
    );
    toast.success("Template status güncellendi", `Yeni durum: ${pendingStatus}`);
    setActionState(null);
    router.refresh();
  }

  async function archiveTemplate() {
    if (!selected) return;
    const accepted = await confirm({
      title: "Template archive edilsin mi?",
      message: `"${selected.title}" archive durumuna alınacak.`,
      confirmLabel: "Archive et",
      cancelLabel: "Vazgeç",
      tone: "warning"
    });
    if (!accepted) return;

    setActionState("archive");
    const response = await fetch(`/api/templates/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateItem };
    if (!response.ok || !payload.ok || !payload.template) {
      toast.error("Template archive edilemedi", payload.error ?? "İşlem başarısız.");
      setActionState(null);
      return;
    }
    setTemplates((prev) =>
      prev.map((t) => (t.id === selected.id ? { ...payload.template!, campaignCount: t.campaignCount } : t))
    );
    toast.info("Template archive edildi");
    setActionState(null);
    router.refresh();
  }

  async function deleteTemplate() {
    if (!selected) return;

    if (!canHardDelete) {
      toast.warning("Template campaign'lerde kullanılıyor", "Template is used by campaigns. Archive it instead.");
      return;
    }

    const accepted = await confirm({
      title: "Template silinsin mi?",
      message: `"${selected.title}" kalıcı olarak silinecek.`,
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      tone: "danger"
    });
    if (!accepted) return;

    setActionState("delete");
    const response = await fetch(`/api/templates/${selected.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
    };
    if (!response.ok || !payload.ok) {
      if (payload.code === "template_in_use") {
        toast.warning("Template silinemedi", payload.error ?? "Template is used by campaigns. Archive it instead.");
      } else {
        toast.error("Template silinemedi", payload.error ?? "İşlem başarısız.");
      }
      setActionState(null);
      return;
    }
    const next = templates.filter((t) => t.id !== selected.id);
    setTemplates(next);
    setSelectedId(next[0]?.id ?? "");
    toast.success("Template silindi");
    setActionState(null);
    router.refresh();
  }

  async function runTestSend() {
    if (!selected) return;
    if (!testSend.toEmail.trim()) {
      toast.warning("Test e-posta adresi gerekli");
      return;
    }
    if (!testSend.smtpAccountId) {
      toast.warning("Aktif SMTP hesabı seçin");
      return;
    }

    setActionState("testSend");
    const response = await fetch(`/api/templates/${selected.id}/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testSend)
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; hint?: string };
    if (response.ok && payload.ok) {
      toast.success("Test gönderimi başarılı");
      setActionState(null);
      return;
    }
    toast.error(
      "Test gönderimi başarısız",
      `${payload.error ?? "SMTP veya alıcı kontrol edin."}${payload.hint ? ` ${payload.hint}` : ""}`
    );
    setActionState(null);
  }

  async function testSmtpConnection() {
    if (!testSend.smtpAccountId) {
      toast.warning("Önce SMTP seçin");
      return;
    }

    setActionState("testSmtp");
    const response = await fetch(`/api/smtp/${testSend.smtpAccountId}/test-connection`, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (response.ok && payload.ok) {
      toast.success("SMTP bağlantısı başarılı");
      setActionState(null);
      return;
    }
    toast.error("SMTP bağlantı testi başarısız", payload.error ?? "Bağlantı kurulamadı");
    setActionState(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-200">
          <ShieldQuestion className="h-4 w-4 text-indigo-300" />
          Tracking Setup Guide
        </div>
        <ul className="space-y-1 text-xs text-zinc-300">
          <li>Open pixel takibi: `/track/open/[token]` endpoint’i üzerinden çalışır.</li>
          <li>Link tracking: kampanya linkleri `/track/click/[token]` adresine rewrite edilir.</li>
          <li>Unsubscribe: `/unsubscribe/[token]` linki suppression sürecini tetikler.</li>
          <li>Campaign pipeline tracking tokenlarını otomatik enjekte eder.</li>
          <li>Placeholderlar: recipient email/name, unsubscribe link, campaign variable alanları.</li>
        </ul>
      </div>

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
              disabled={actionState !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
            >
              {actionState === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
                  onClick={() => {
                    setSelectedId(template.id);
                    setPendingStatus((template.status as TemplateStatus) ?? "draft");
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${
                    selectedId === template.id ? "border-indigo-400/40 bg-indigo-500/10" : "border-border bg-zinc-900/40"
                  }`}
                >
                  <p className="text-sm font-medium text-white">{template.title}</p>
                  <p className="text-xs text-zinc-400">{template.subject}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">Campaign usage: {template.campaignCount}</p>
                </button>
              ))}
            </div>

            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{selected.title}</p>
                    <StatusBadge label={selected.status} tone={statusTone(selected.status)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-200"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateTemplate()}
                      disabled={actionState !== null}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-200 disabled:opacity-60"
                    >
                      {actionState === "update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                      Update
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTemplate()}
                      disabled={actionState !== null || !canHardDelete}
                      title={!canHardDelete ? "Template campaign'lerde kullanılıyor. Archive edin." : undefined}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-xs text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionState === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Delete
                    </button>
                    {!canHardDelete ? (
                      <button
                        type="button"
                        onClick={() => void archiveTemplate()}
                        disabled={actionState !== null}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 px-2.5 py-1.5 text-xs text-amber-300 disabled:opacity-60"
                      >
                        {actionState === "archive" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Archive
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-[170px_1fr_auto]">
                  <select
                    className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200"
                    value={pendingStatus}
                    onChange={(e) => setPendingStatus(e.target.value as TemplateStatus)}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                    <option value="disabled">Disabled</option>
                  </select>
                  <p className="self-center text-xs text-zinc-500">Status değişikliği confirm modal ile uygulanır.</p>
                  <button
                    type="button"
                    onClick={() => void changeStatus()}
                    disabled={actionState !== null}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
                  >
                    {actionState === "status" ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null} Apply Status
                  </button>
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void runTestSend()}
                      disabled={!smtpOptions.length || actionState !== null}
                      title={!smtpOptions.length ? "No SMTP account available" : undefined}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-500"
                    >
                      {actionState === "testSend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                      Send test mail
                    </button>
                    <button
                      type="button"
                      onClick={() => void testSmtpConnection()}
                      disabled={!testSend.smtpAccountId || actionState !== null}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
                    >
                      {actionState === "testSmtp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
                      Test SMTP connection
                    </button>
                    <Link
                      href="/settings/smtp"
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-zinc-300"
                    >
                      SMTP settings
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-zinc-900/60 p-4 text-sm text-zinc-400">No template selected</div>
            )}
          </div>
        </section>
      </div>

      {previewOpen && selected ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-2xl border border-border/80 bg-[#0f1420] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Template Preview</p>
                <p className="text-xs text-zinc-400">{selected.subject}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewMode("desktop")}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    previewMode === "desktop" ? "border-indigo-400/40 text-indigo-200" : "border-border text-zinc-300"
                  }`}
                >
                  Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode("mobile")}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    previewMode === "mobile" ? "border-indigo-400/40 text-indigo-200" : "border-border text-zinc-300"
                  }`}
                >
                  Mobile
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-zinc-300"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
              <div className="rounded-xl border border-border bg-zinc-950 p-2">
                <iframe
                  title="template-preview"
                  sandbox=""
                  srcDoc={selected.htmlBody}
                  className={`h-[540px] w-full rounded-lg border border-border bg-white ${
                    previewMode === "mobile" ? "mx-auto max-w-[390px]" : ""
                  }`}
                />
              </div>
              <div className="rounded-xl border border-border bg-zinc-900/60 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Plain Text Preview</p>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">{selected.plainTextBody || "(empty)"}</pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
