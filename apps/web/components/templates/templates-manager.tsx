"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Info, Loader2, MailPlus, Search, Server, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { OverlayPortal } from "@/components/ui/overlay-portal";

type TemplateStatus = "draft" | "active" | "archived" | "disabled";
type SortMode = "updated_desc" | "created_desc" | "name" | "usage_count";
type PageSize = 25 | 50 | 100;
type EditorTab = "editor" | "preview" | "testSend" | "tracking";
type PreviewMode = "desktop" | "mobile";

type TemplateListItem = {
  id: string;
  title: string;
  subject: string;
  category: string | null;
  version: number;
  status: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

type TemplateDetail = TemplateListItem & {
  htmlBody: string;
  plainTextBody: string | null;
};

type TemplateListResponse = {
  ok: boolean;
  items: TemplateListItem[];
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
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
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
  const [selected, setSelected] = useState<TemplateDetail | null>(null);
  const [selectedStatusDraft, setSelectedStatusDraft] = useState<TemplateStatus>("draft");

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
  const [shortenForm, setShortenForm] = useState({
    destinationUrl: "",
    customAlias: ""
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
        throw new Error(payload.error ?? "Templates could not be loaded");
      }
      setTemplates(payload.items ?? []);
      setTotal(payload.total ?? 0);
      setTotalPages(payload.totalPages ?? 1);
      setCategories(payload.categories ?? []);
    } catch (error) {
      toast.error("Templates could not be loaded", error instanceof Error ? error.message : "Unexpected error");
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
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateDetail };
      if (!response.ok || !payload.ok || !payload.template) {
        throw new Error(payload.error ?? "Template could not be created");
      }
      toast.success(statusOverride === "active" ? "Template saved as active" : "Template draft saved");
      setCreateOpen(false);
      setCreateForm({ title: "", subject: "", htmlBody: "", plainTextBody: "", category: "", status: "draft" });
      setPage(1);
      await loadTemplates();
    } catch (error) {
      toast.error("Template could not be created", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function saveEditor(statusOverride?: TemplateStatus) {
    if (!selected) return;
    const nextStatus = statusOverride ?? selected.status;
    if (nextStatus !== selected.status) {
      const confirmed = await confirm({
        title: "Confirm status change",
        message:
          nextStatus === "disabled" && selected.usageCount > 0
            ? "This template is used in campaigns. Do you want to disable it?"
            : `Template status will be updated to "${nextStatus}".`,
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        tone: nextStatus === "disabled" ? "warning" : "info"
      });
      if (!confirmed) return;
    }
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
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateDetail };
      if (!response.ok || !payload.ok || !payload.template) {
        throw new Error(payload.error ?? "Template could not be saved");
      }
      const updated = {
        ...payload.template,
        usageCount: selected.usageCount
      };
      setSelected(updated);
      setSelectedStatusDraft((updated.status as TemplateStatus) ?? "draft");
      setTemplates((prev) =>
        prev.map((item) =>
          item.id === updated.id
            ? {
                ...item,
                title: updated.title,
                subject: updated.subject,
                category: updated.category,
                status: updated.status,
                version: updated.version,
                updatedAt: updated.updatedAt
              }
            : item
        )
      );
      toast.success(statusOverride ? `Template saved as ${statusOverride}` : "Template saved");
      await loadTemplates();
    } catch (error) {
      toast.error("Template could not be saved", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function archiveTemplate() {
    if (!selected) return;
    const approved = await confirm({
      title: "Archive template?",
      message: "Template status will be changed to archived.",
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      tone: "warning"
    });
    if (!approved) return;
    await saveEditor("archived");
  }

  async function deleteTemplate() {
    if (!selected) return;
    const approved = await confirm({
      title: "Delete template?",
      message: "If this template is in use, archiving will be recommended instead.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
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
            title: "Template is used by campaigns",
            message: "Archive instead of hard delete?",
            confirmLabel: "Archive",
            cancelLabel: "Cancel",
            tone: "warning"
          });
          if (archiveApprove) {
            await saveEditor("archived");
          }
          return;
        }
        throw new Error(payload.error ?? "Template could not be deleted");
      }
      toast.success("Template deleted");
      setEditorOpen(false);
      setSelected(null);
      await loadTemplates();
    } catch (error) {
      toast.error("Template could not be deleted", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function runTestSend() {
    if (!selected) return;
    if (!testSend.toEmail.trim()) {
      toast.warning("Recipient email is required for test send");
      return;
    }
    if (!testSend.smtpAccountId) {
      toast.warning("Select an SMTP account");
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
      toast.success("Test send succeeded");
    } catch (error) {
      toast.error("Test send failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function testSmtpConnection() {
    if (!testSend.smtpAccountId) {
      toast.warning("Select an SMTP account");
      return;
    }
    setActionLoading("testSmtp");
    try {
      const response = await fetch(`/api/smtp/${testSend.smtpAccountId}/test-connection`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "SMTP test failed");
      }
      toast.success("SMTP connection test succeeded");
    } catch (error) {
      toast.error("SMTP test failed", error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setActionLoading(null);
    }
  }

  async function shortenAndInsertLink() {
    if (!selected) return;
    const destination = shortenForm.destinationUrl.trim();
    if (!destination) {
      toast.warning("Destination URL is required");
      return;
    }
    setActionLoading("shortenLink");
    try {
      const response = await fetch("/api/short-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_url: destination,
          ...(shortenForm.customAlias.trim() ? { url: shortenForm.customAlias.trim() } : {}),
          utm_source: "nexus-mail",
          utm_medium: "email",
          utm_campaign: selected.title
        })
      });
      const payload = (await response.json().catch(() => ({}))) as any;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.code ?? payload.error ?? "shortener_api_failed");
      }
      const data = payload?.data ?? payload;
      const shortUrl = String(data?.url ?? data?.short_url ?? "");
      if (!shortUrl) {
        throw new Error("shortener_api_failed");
      }
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              htmlBody: `${prev.htmlBody}\n<a href="${shortUrl}">${shortUrl}</a>`
            }
          : prev
      );
      setShortenForm({ destinationUrl: "", customAlias: "" });
      toast.success("Short URL inserted into template");
    } catch (error) {
      toast.error("Shorten link failed", error instanceof Error ? error.message : "shortener_api_failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function fetchTemplateDetail(id: string) {
    setActionLoading("openEditor");
    try {
      const response = await fetch(`/api/templates/${id}`);
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; template?: TemplateDetail };
      if (!response.ok || !payload.ok || !payload.template) {
        throw new Error(payload.error ?? "Template detail could not be loaded");
      }
      return payload.template;
    } finally {
      setActionLoading(null);
    }
  }

  const listCaption = useMemo(() => `Total ${total} templates · Page ${page}/${totalPages}`, [page, total, totalPages]);

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
            Loading templates...
          </div>
        ) : templates.length === 0 ? (
          <div className="p-4">
            <EmptyState icon="mail-plus" title="No templates found" description="Change filters or create a new template." />
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
                            onClick={async () => {
                              const detail = await fetchTemplateDetail(item.id);
                              if (!detail) return;
                              setSelected(detail);
                              setSelectedStatusDraft((detail.status as TemplateStatus) ?? "draft");
                              setEditorTab("editor");
                              setEditorOpen(true);
                            }}
                            className="rounded border border-border px-2 py-1 text-xs"
                          >
                            Edit
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

      <SimpleModal open={trackingOpen} onClose={() => setTrackingOpen(false)} title="Tracking Guide">
        <div className="space-y-2 text-sm text-zinc-300">
          <p><strong>Open tracking:</strong> <code>{"{{tracking_pixel}}"}</code> injects the open pixel placeholder.</p>
          <p><strong>Click tracking:</strong> HTML links are rewritten to the `/track/click/[token]` endpoint.</p>
          <p><strong>Unsubscribe:</strong> <code>{"{{unsubscribe_url}}"}</code> inserts the global unsubscribe link.</p>
          <p><strong>Supported placeholders:</strong> <code>name</code>, <code>email</code>, <code>first_name</code>, <code>last_name</code>, <code>{"{{tracking_pixel}}"}</code>, <code>{"{{unsubscribe_url}}"}</code>.</p>
          <pre className="rounded border border-border bg-zinc-900/70 p-2 text-xs text-zinc-200">{buildTrackingSnippet()}</pre>
        </div>
      </SimpleModal>

      <SimpleModal open={createOpen} onClose={() => setCreateOpen(false)} title="New Template" maxWidthClass="max-w-4xl">
        <div className="grid gap-2">
          <input value={createForm.title} onChange={(e) => setCreateForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Template name" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
          <input value={createForm.subject} onChange={(e) => setCreateForm((prev) => ({ ...prev, subject: e.target.value }))} placeholder="Subject" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
          <input value={createForm.category} onChange={(e) => setCreateForm((prev) => ({ ...prev, category: e.target.value }))} placeholder="Tags / category" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
          <select value={createForm.status} onChange={(e) => setCreateForm((prev) => ({ ...prev, status: e.target.value as "draft" | "active" }))} className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100">
            <option value="draft">draft</option>
            <option value="active">active</option>
          </select>
          <textarea rows={10} value={createForm.htmlBody} onChange={(e) => setCreateForm((prev) => ({ ...prev, htmlBody: e.target.value }))} placeholder="HTML body" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
          <textarea rows={5} value={createForm.plainTextBody} onChange={(e) => setCreateForm((prev) => ({ ...prev, plainTextBody: e.target.value }))} placeholder="Plain text body" className="rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={actionLoading === "create"} onClick={() => void createTemplate("draft")} className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-50">
            {actionLoading === "create" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
            Save draft
          </button>
          <button type="button" disabled={actionLoading === "create"} onClick={() => void createTemplate("active")} className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">
            Save & activate
          </button>
        </div>
      </SimpleModal>

      {editorOpen && selected ? (
        <OverlayPortal active={editorOpen} lockScroll>
          <div className="fixed inset-0 z-40 bg-black/60 p-3 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
            <div className="ml-auto h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">{selected.title}</p>
                <p className="text-xs text-zinc-400">
                  Version v{selected.version} · Usage {selected.usageCount}
                </p>
              </div>
              <div className="flex gap-2">
                <StatusBadge label={selected.status} tone={statusTone(selected.status)} />
                <select
                  value={selectedStatusDraft}
                  onChange={(e) => setSelectedStatusDraft(e.target.value as TemplateStatus)}
                  className="rounded border border-border bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                >
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                  <option value="archived">archived</option>
                </select>
                <button type="button" className="rounded border border-border px-2 py-1 text-xs text-zinc-200" onClick={() => void saveEditor(selectedStatusDraft)}>
                  Apply status
                </button>
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
                <div className="grid gap-2 rounded-lg border border-border bg-zinc-900/40 p-2 md:grid-cols-[1fr_180px_auto]">
                  <input
                    value={shortenForm.destinationUrl}
                    onChange={(e) => setShortenForm((prev) => ({ ...prev, destinationUrl: e.target.value }))}
                    placeholder="Paste destination URL to shorten"
                    className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                  />
                  <input
                    value={shortenForm.customAlias}
                    onChange={(e) => setShortenForm((prev) => ({ ...prev, customAlias: e.target.value }))}
                    placeholder="Custom alias (optional)"
                    className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                  />
                  <button
                    type="button"
                    disabled={actionLoading === "shortenLink"}
                    onClick={() => void shortenAndInsertLink()}
                    className="rounded border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-50"
                  >
                    {actionLoading === "shortenLink" ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                    Shorten Link
                  </button>
                </div>
                <textarea rows={12} value={selected.htmlBody} onChange={(e) => setSelected((prev) => (prev ? { ...prev, htmlBody: e.target.value } : prev))} className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
                <textarea rows={6} value={selected.plainTextBody ?? ""} onChange={(e) => setSelected((prev) => (prev ? { ...prev, plainTextBody: e.target.value || null } : prev))} className="w-full rounded-lg border border-border bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={actionLoading === "save"} onClick={() => void saveEditor()} className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">
                    Save
                  </button>
                  <button type="button" disabled={actionLoading === "save"} onClick={() => void saveEditor("draft")} className="rounded-lg border border-border px-3 py-2 text-sm text-zinc-200 disabled:opacity-50">
                    Save as draft
                  </button>
                  <button type="button" disabled={actionLoading === "save"} onClick={() => void saveEditor("active")} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-200 disabled:opacity-50">
                    Save & activate
                  </button>
                  <button type="button" disabled={actionLoading === "save"} onClick={() => void saveEditor("disabled")} className="rounded-lg border border-orange-500/40 px-3 py-2 text-sm text-orange-200 disabled:opacity-50">
                    Disable
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
                <p><strong>Open tracking:</strong> <code>{"{{tracking_pixel}}"}</code> injects the tracking pixel placeholder.</p>
                <p><strong>Click tracking:</strong> Links are automatically rewritten to click token endpoints.</p>
                <p><strong>Unsubscribe:</strong> <code>{"{{unsubscribe_url}}"}</code> inserts the global unsubscribe link.</p>
                <p className="mt-2 text-xs text-zinc-400">Snippet:</p>
                <pre className="mt-1 rounded border border-border bg-zinc-950 p-2 text-xs text-zinc-200">{buildTrackingSnippet()}</pre>
              </div>
            ) : null}
            </div>
          </div>
        </OverlayPortal>
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

function SimpleModal({
  open,
  onClose,
  title,
  children,
  maxWidthClass = "max-w-3xl"
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  if (!open) return null;
  return (
    <OverlayPortal active={open} lockScroll>
      <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
        <div className={`relative z-[60] mx-auto max-h-[92vh] w-full ${maxWidthClass} overflow-y-auto rounded-2xl border border-border bg-zinc-950 p-4`} onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{title}</p>
            <button type="button" className="rounded border border-border px-2 py-1 text-xs text-zinc-300" onClick={onClose}>
              Close
            </button>
          </div>
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}
