"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, FlaskConical, Info, Loader2, MailPlus, Search, Server, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { EmptyState } from "@/components/ui/empty-state";

type TemplateStatus = "draft" | "active" | "archived" | "disabled";
type SortMode = "updated_desc" | "created_desc" | "name" | "usage_count";
type PageSize = 25 | 50 | 100;
type EditorTab = "editor" | "preview" | "testSend" | "tracking";
type PreviewMode = "desktop" | "mobile";

type TemplateItem = {
  id: string;
  title: string;
  subject: string;
  htmlBody: string;
  plainTextBody: string | null;
  category: string | null;
  version: number;
  status: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

type TemplateListResponse = {
  ok: boolean;
  items: TemplateItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categories: string[];
};

type SmtpOption = { id: string; name: string };

function statusTone(status: string): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "active") return "success";
  if (status === "draft") return "warning";
  if (status === "archived" || status === "disabled") return "muted";
  return "info";
}

function buildTrackingSnippet() {
  return `<a href="{{unsubscribe_url}}">Unsubscribe</a>\n{{tracking_pixel}}`;
}

export function TemplatesManager({ smtpOptions }: { smtpOptions: SmtpOption[] }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | TemplateStatus>("all");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<SortMode>("updated_desc");

  const [trackingOpen, setTrackingOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("editor");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateItem | null>(null);
  const [selected, setSelected] = useState<TemplateItem | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    title: "",
    subject: "",
    htmlBody: "",
    plainTextBody: "",
    category: "",
    status: "draft" as "draft" | "active"
  });
  const [testSend, setTestSend] = useState({
    smtpAccountId: smtpOptions[0]?.id ?? "",
    toEmail: ""
  });

  async function loadTemplates() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: `${page}`,
        pageSize: `${pageSize}`,
        search,
        status,
        tag,
        sort
      });
      const response = await fetch(`/api/templates?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as TemplateListResponse & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Template listesi yüklenemedi");
      }
      setTemplates(payload.items ?? []);
      setTotal(payload.total ?? 0);
      setTotalPages(payload.totalPages ?? 1);
      setCategories(payload.categories ?? []);
    } catch (error) {
      toast.error("Template listesi yüklenemedi", error instanceof Error ? error.message : "Beklenmeyen hata");
      setTemplates([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, [page, pageSize, status, sort, tag]);

  function resetAndSearch() {
    setPage(1);
    void loadTemplates();
  }

  async function createTemplate(statusOverride: "draft" | "active") {
    setActionLoading("create");
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createForm,
          status: statusOverride
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateItem };
      if (!response.ok || !payload.ok || !payload.template) {
        throw new Error(payload.error ?? "Template oluşturulamadı");
      }
      toast.success(statusOverride === "active" ? "Template active olarak kaydedildi" : "Template draft kaydedildi");
      setCreateOpen(false);
      setCreateForm({ title: "", subject: "", htmlBody: "", plainTextBody: "", category: "", status: "draft" });
      setPage(1);
      await loadTemplates();
    } catch (error) {
      toast.error("Template oluşturulamadı", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  async function saveEditor(statusOverride?: TemplateStatus) {
    if (!selected) return;
    setActionLoading("save");
    try {
      const response = await fetch(`/api/templates/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selected.title,
          subject: selected.subject,
          htmlBody: selected.htmlBody,
          plainTextBody: selected.plainTextBody,
          category: selected.category,
          ...(statusOverride ? { status: statusOverride } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateItem };
      if (!response.ok || !payload.ok || !payload.template) {
        throw new Error(payload.error ?? "Template kaydedilemedi");
      }
      const updated = {
        ...payload.template,
        usageCount: selected.usageCount
      };
      setSelected(updated);
      setTemplates((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(statusOverride ? `Template ${statusOverride} olarak kaydedildi` : "Template kaydedildi");
      await loadTemplates();
    } catch (error) {
      toast.error("Template kaydedilemedi", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  async function archiveTemplate() {
    if (!selected) return;
    const approved = await confirm({
      title: "Template arşivlensin mi?",
      message: "Template archived duruma alınacak.",
      confirmLabel: "Archive",
      cancelLabel: "Vazgeç",
      tone: "warning"
    });
    if (!approved) return;
    await saveEditor("archived");
  }

  async function deleteTemplate() {
    if (!selected) return;
    const approved = await confirm({
      title: "Template silinsin mi?",
      message: "Campaign kullanımına bağlı olarak archive önerilebilir.",
      confirmLabel: "Sil",
      cancelLabel: "Vazgeç",
      tone: "danger"
    });
    if (!approved) return;

    setActionLoading("delete");
    try {
      const response = await fetch(`/api/templates/${selected.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        if (payload.code === "template_in_use") {
          const archiveApprove = await confirm({
            title: "Template campaign tarafından kullanılıyor",
            message: "Hard delete yerine archive edilsin mi?",
            confirmLabel: "Archive et",
            cancelLabel: "Vazgeç",
            tone: "warning"
          });
          if (archiveApprove) {
            await saveEditor("archived");
          }
          return;
        }
        throw new Error(payload.error ?? "Template silinemedi");
      }
      toast.success("Template silindi");
      setEditorOpen(false);
      setSelected(null);
      await loadTemplates();
    } catch (error) {
      toast.error("Template silinemedi", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  async function runTestSend() {
    if (!selected) return;
    if (!testSend.toEmail.trim()) {
      toast.warning("Test alıcı e-posta alanı zorunlu");
      return;
    }
    if (!testSend.smtpAccountId) {
      toast.warning("SMTP seçin");
      return;
    }
    setActionLoading("testSend");
    try {
      const response = await fetch(`/api/templates/${selected.id}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testSend)
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; hint?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(`${payload.error ?? "Test send failed"}${payload.hint ? ` ${payload.hint}` : ""}`);
      }
      toast.success("Test gönderimi başarılı");
    } catch (error) {
      toast.error("Test gönderimi başarısız", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  async function testSmtpConnection() {
    if (!testSend.smtpAccountId) {
      toast.warning("SMTP seçin");
      return;
    }
    setActionLoading("testSmtp");
    try {
      const response = await fetch(`/api/smtp/${testSend.smtpAccountId}/test-connection`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "SMTP test başarısız");
      }
      toast.success("SMTP bağlantı testi başarılı");
    } catch (error) {
      toast.error("SMTP test başarısız", error instanceof Error ? error.message : "Beklenmeyen hata");
    } finally {
      setActionLoading(null);
    }
  }

  const listCaption = useMemo(() => `Toplam ${total} template · Sayfa ${page}/${totalPages}`, [page, total, totalPages]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") resetAndSearch();
              }}
              placeholder="Search template..."
              className="w-full rounded-lg border border-border bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100"
            />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value as "all" | TemplateStatus)} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
            <option value="all">Status: all</option>
            <option value="active">active</option>
            <option value="draft">draft</option>
            <option value="disabled">disabled</option>
            <option value="archived">archived</option>
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
            <option value="">Category/tag: all</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="rounded-lg border border-border bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
            <option value="updated_desc">Sort: updated desc</option>
            <option value="created_desc">Sort: created desc</option>
            <option value="name">Sort: name</option>
            <option value="usage_count">Sort: usage count</option>
          </select>
          <button type="button" onClick={() => void resetAndSearch()} className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200">
            Apply
          </button>
          <button type="button" onClick={() => setTrackingOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">
            <Info className="h-4 w-4" />
            Tracking guide
          </button>
          <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white">
            <MailPlus className="h-4 w-4" />
            New Template
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs text-zinc-400">
          <p>{listCaption}</p>
          <select value={`${pageSize}`} onChange={(e) => { setPageSize(Number(e.target.value) as PageSize); setPage(1); }} className="rounded border border-border bg-zinc-950 px-2 py-1 text-xs text-zinc-200">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-zinc-400">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Templates yükleniyor...
          </div>
        ) : templates.length === 0 ? (
          <div className="p-4">
            <EmptyState icon="mail-plus" title="Template bulunamadı" description="Filtreyi değiştir veya yeni template oluştur." />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Category/Tag</th>
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Usage</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((item) => (
                    <tr key={item.id} className="border-t border-border text-zinc-200 hover:bg-zinc-900/35">
                      <td className="px-3 py-2 font-medium text-white">{item.title}</td>
                      <td className="max-w-[320px] truncate px-3 py-2">{item.subject}</td>
                      <td className="px-3 py-2">
                        <StatusBadge label={item.status} tone={statusTone(item.status)} />
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-300">{item.category ?? "-"}</td>
                      <td className="px-3 py-2">v{item.version}</td>
                      <td className="px-3 py-2">{item.usageCount}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400">{new Date(item.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelected({ ...item });
                              setEditorTab("editor");
                              setEditorOpen(true);
                            }}
                            className="rounded border border-border px-2 py-1 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewTemplate(item);
                              setPreviewMode("desktop");
                              setPreviewOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Preview
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-zinc-300">
              <p>
                Page {page} / {totalPages}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))} className="rounded border border-border px-2 py-1 disabled:opacity-50">
                  Prev
                </button>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} className="rounded border border-border px-2 py-1 disabled:opacity-50">
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {trackingOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/60 p-4 backdrop-blur-sm" onClick={() => setTrackingOpen(false)}>
          <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Tracking Guide</p>
              <button type="button" className="rounded border border-border px-2 py-1 text-xs text-zinc-300" onClick={() => setTrackingOpen(false)}>
                Close
              </button>
            </div>
            <div className="space-y-2 text-sm text-zinc-300">
              <p><strong>Open tracking:</strong> <code>{"{{tracking_pixel}}"}</code> placeholder ile open pixel enjekte edilir.</p>
              <p><strong>Click tracking:</strong> HTML linkleri otomatik `/track/click/[token]` endpointine rewrite edilir.</p>
              <p><strong>Unsubscribe:</strong> <code>{"{{unsubscribe_url}}"}</code> ile global unsubscribe linki eklenir.</p>
              <p><strong>Supported placeholders:</strong> <code>name</code>, <code>email</code>, <code>first_name</code>, <code>last_name</code>, <code>{"{{tracking_pixel}}"}</code>, <code>{"{{unsubscribe_url}}"}</code>.</p>
              <pre className="rounded border border-border bg-zinc-900/70 p-2 text-xs text-zinc-200">{buildTrackingSnippet()}</pre>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/60 p-4 backdrop-blur-sm" onClick={() => setCreateOpen(false)}>
          <div className="mx-auto max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold text-white">New Template</p>
            <div className="grid gap-2">
              <input value={createForm.title} onChange={(e) => setCreateForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Template name" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
              <input value={createForm.subject} onChange={(e) => setCreateForm((prev) => ({ ...prev, subject: e.target.value }))} placeholder="Subject" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
              <input value={createForm.category} onChange={(e) => setCreateForm((prev) => ({ ...prev, category: e.target.value }))} placeholder="Category / tags" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
              <textarea rows={10} value={createForm.htmlBody} onChange={(e) => setCreateForm((prev) => ({ ...prev, htmlBody: e.target.value }))} placeholder="HTML body" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
              <textarea rows={5} value={createForm.plainTextBody} onChange={(e) => setCreateForm((prev) => ({ ...prev, plainTextBody: e.target.value }))} placeholder="Plain text body" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={actionLoading === "create"} onClick={() => void createTemplate("draft")} className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-50">
                {actionLoading === "create" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                Save draft
              </button>
              <button type="button" disabled={actionLoading === "create"} onClick={() => void createTemplate("active")} className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">
                Save active
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editorOpen && selected ? (
        <div className="fixed inset-0 z-[120] bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
          <div className="ml-auto h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">{selected.title}</p>
                <p className="text-xs text-zinc-400">
                  Version v{selected.version} · Usage {selected.usageCount}
                </p>
              </div>
              <div className="flex gap-2">
                <StatusBadge label={selected.status} tone={statusTone(selected.status)} />
                <button type="button" className="rounded border border-border px-2 py-1 text-xs text-zinc-300" onClick={() => setEditorOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <TabButton active={editorTab === "editor"} onClick={() => setEditorTab("editor")} label="Editor" />
              <TabButton active={editorTab === "preview"} onClick={() => setEditorTab("preview")} label="Preview" />
              <TabButton active={editorTab === "testSend"} onClick={() => setEditorTab("testSend")} label="Test Send" />
              <TabButton active={editorTab === "tracking"} onClick={() => setEditorTab("tracking")} label="Tracking Guide" />
            </div>

            {editorTab === "editor" ? (
              <div className="space-y-2">
                <input value={selected.title} onChange={(e) => setSelected((prev) => (prev ? { ...prev, title: e.target.value } : prev))} className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
                <input value={selected.subject} onChange={(e) => setSelected((prev) => (prev ? { ...prev, subject: e.target.value } : prev))} className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
                <input value={selected.category ?? ""} onChange={(e) => setSelected((prev) => (prev ? { ...prev, category: e.target.value || null } : prev))} placeholder="Category / tags" className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
                <textarea rows={12} value={selected.htmlBody} onChange={(e) => setSelected((prev) => (prev ? { ...prev, htmlBody: e.target.value } : prev))} className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
                <textarea rows={6} value={selected.plainTextBody ?? ""} onChange={(e) => setSelected((prev) => (prev ? { ...prev, plainTextBody: e.target.value || null } : prev))} className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={actionLoading === "save"} onClick={() => void saveEditor()} className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">
                    Save
                  </button>
                  <button type="button" disabled={actionLoading === "save"} onClick={() => void saveEditor("draft")} className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-50">
                    Save as draft
                  </button>
                  <button type="button" disabled={actionLoading === "save"} onClick={() => void archiveTemplate()} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-50">
                    Archive
                  </button>
                  <button type="button" disabled={actionLoading === "delete"} onClick={() => void deleteTemplate()} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/50 px-3 py-2 text-sm text-rose-300 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            ) : null}

            {editorTab === "preview" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setPreviewMode("desktop")} className={`rounded border px-2 py-1 text-xs ${previewMode === "desktop" ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>Desktop</button>
                  <button type="button" onClick={() => setPreviewMode("mobile")} className={`rounded border px-2 py-1 text-xs ${previewMode === "mobile" ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>Mobile</button>
                </div>
                <p className="text-xs text-zinc-400">Subject: {selected.subject}</p>
                <div className="rounded-lg border border-border bg-zinc-950 p-2">
                  <iframe title="template-preview-drawer" sandbox="" srcDoc={selected.htmlBody} className={`h-[520px] w-full rounded border border-border bg-white ${previewMode === "mobile" ? "mx-auto max-w-[390px]" : ""}`} />
                </div>
                <div className="rounded-lg border border-border bg-zinc-900/50 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Plain text preview</p>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">{selected.plainTextBody || "(empty)"}</pre>
                </div>
              </div>
            ) : null}

            {editorTab === "testSend" ? (
              <div className="rounded-lg border border-border bg-zinc-900/50 p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Test Send</p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <select value={testSend.smtpAccountId} onChange={(e) => setTestSend((prev) => ({ ...prev, smtpAccountId: e.target.value }))} className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100">
                    {smtpOptions.map((smtp) => (
                      <option key={smtp.id} value={smtp.id}>
                        {smtp.name}
                      </option>
                    ))}
                  </select>
                  <input value={testSend.toEmail} onChange={(e) => setTestSend((prev) => ({ ...prev, toEmail: e.target.value }))} placeholder="recipient@email.com" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 md:col-span-2" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void runTestSend()} disabled={actionLoading === "testSend"} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-50">
                    {actionLoading === "testSend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                    Send test
                  </button>
                  <button type="button" onClick={() => void testSmtpConnection()} disabled={actionLoading === "testSmtp"} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-50">
                    {actionLoading === "testSmtp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
                    Test SMTP
                  </button>
                  <Link href="/settings/smtp" className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-300">
                    SMTP settings
                  </Link>
                </div>
              </div>
            ) : null}

            {editorTab === "tracking" ? (
              <div className="rounded-lg border border-border bg-zinc-900/50 p-3 text-sm text-zinc-300">
                <p><strong>Open tracking:</strong> <code>{"{{tracking_pixel}}"}</code> placeholder ile pixel enjekte edilir.</p>
                <p><strong>Click tracking:</strong> Linkler otomatik click token endpointine rewrite edilir.</p>
                <p><strong>Unsubscribe:</strong> <code>{"{{unsubscribe_url}}"}</code> ile global unsub linki eklenir.</p>
                <p className="mt-2 text-xs text-zinc-400">Snippet:</p>
                <pre className="mt-1 rounded border border-border bg-zinc-950 p-2 text-xs text-zinc-200">{buildTrackingSnippet()}</pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {previewOpen && previewTemplate ? (
        <div className="fixed inset-0 z-[120] bg-black/60 p-4 backdrop-blur-sm" onClick={() => setPreviewOpen(false)}>
          <div className="mx-auto max-w-5xl rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Template Preview</p>
                <p className="text-xs text-zinc-400">{previewTemplate.subject}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPreviewMode("desktop")} className={`rounded border px-2 py-1 text-xs ${previewMode === "desktop" ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>Desktop</button>
                <button type="button" onClick={() => setPreviewMode("mobile")} className={`rounded border px-2 py-1 text-xs ${previewMode === "mobile" ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>Mobile</button>
                <button type="button" onClick={() => setPreviewOpen(false)} className="rounded border border-border px-2 py-1 text-xs text-zinc-300">Close</button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
              <div className="rounded-lg border border-border bg-zinc-950 p-2">
                <iframe title="template-preview-modal" sandbox="" srcDoc={previewTemplate.htmlBody} className={`h-[540px] w-full rounded border border-border bg-white ${previewMode === "mobile" ? "mx-auto max-w-[390px]" : ""}`} />
              </div>
              <div className="rounded-lg border border-border bg-zinc-900/50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Plain text preview</p>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">{previewTemplate.plainTextBody || "(empty)"}</pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`rounded border px-2 py-1 text-xs ${active ? "border-indigo-400 text-indigo-200" : "border-border text-zinc-300"}`}>
      {label}
    </button>
  );
}
