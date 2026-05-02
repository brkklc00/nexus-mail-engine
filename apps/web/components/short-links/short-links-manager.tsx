"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Link2, Loader2, Pencil, RefreshCcw, Trash2 } from "lucide-react";
import { useConfirm, useToast } from "@/components/ui/notification-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { OverlayPortal } from "@/components/ui/overlay-portal";

type ShortLinkItem = {
  id: string;
  shortUrl: string;
  alias: string | null;
  destinationUrl: string;
  clicks: number;
  enabled: boolean;
  type: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
};

type FormState = {
  location_url: string;
  url: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  forward_query_parameters_is_enabled: boolean;
  http_status_code: 301 | 302 | 307 | 308;
};

const DEFAULT_FORM: FormState = {
  location_url: "",
  url: "",
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  forward_query_parameters_is_enabled: true,
  http_status_code: 302
};

function normalizeItem(raw: any): ShortLinkItem {
  const created = raw?.created_at ?? raw?.createdAt ?? raw?.datetime_create ?? null;
  const last = raw?.last_activity ?? raw?.lastActivityAt ?? raw?.datetime_last_click ?? null;
  return {
    id: String(raw?.id ?? raw?.link_id ?? ""),
    shortUrl: String(raw?.url ?? raw?.short_url ?? raw?.shortUrl ?? ""),
    alias: raw?.alias ? String(raw.alias) : null,
    destinationUrl: String(raw?.location_url ?? raw?.destination_url ?? raw?.locationUrl ?? ""),
    clicks: Number(raw?.clicks ?? raw?.click_count ?? 0),
    enabled: raw?.is_enabled === false ? false : true,
    type: raw?.type ? String(raw.type) : null,
    createdAt: created ? String(created) : null,
    lastActivityAt: last ? String(last) : null
  };
}

export function ShortLinksManager() {
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<ShortLinkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [resultsPerPage, setResultsPerPage] = useState(25);
  const [openCreate, setOpenCreate] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [editing, setEditing] = useState<ShortLinkItem | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [filters, setFilters] = useState({
    search: "",
    search_by: "url",
    type: "",
    is_enabled: "all",
    datetime_start: "",
    datetime_end: "",
    order_by: "clicks",
    order_type: "desc"
  });

  async function loadLinks() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: filters.search,
        search_by: filters.search_by,
        type: filters.type,
        order_by: filters.order_by,
        order_type: filters.order_type,
        page: String(page),
        results_per_page: String(resultsPerPage)
      });
      if (filters.is_enabled !== "all") params.set("is_enabled", filters.is_enabled);
      if (filters.datetime_start) params.set("datetime_start", filters.datetime_start);
      if (filters.datetime_end) params.set("datetime_end", filters.datetime_end);

      const response = await fetch(`/api/short-links?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as any;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.code ?? payload.error ?? "shortener_api_failed");
      }
      const rawItems: any[] = payload?.data?.results ?? payload?.results ?? payload?.data ?? [];
      const normalized = (Array.isArray(rawItems) ? rawItems : []).map(normalizeItem);
      setItems(normalized);
      setTotal(Number(payload?.data?.count ?? payload?.count ?? normalized.length));
    } catch (error) {
      toast.error("Short links could not be loaded", error instanceof Error ? error.message : "shortener_api_failed");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLinks();
  }, [page, resultsPerPage]);

  const stats = useMemo(() => {
    const totalClicks = items.reduce((sum, item) => sum + item.clicks, 0);
    const top = [...items].sort((a, b) => b.clicks - a.clicks)[0] ?? null;
    const lastCreated = [...items]
      .filter((item) => item.createdAt)
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0] ?? null;
    return {
      totalLinks: total,
      totalClicks,
      top,
      lastCreated
    };
  }, [items, total]);

  async function createOrUpdate() {
    const payload = {
      location_url: form.location_url,
      ...(form.url.trim() ? { url: form.url.trim() } : {}),
      ...(form.utm_source.trim() ? { utm_source: form.utm_source.trim() } : {}),
      ...(form.utm_medium.trim() ? { utm_medium: form.utm_medium.trim() } : {}),
      ...(form.utm_campaign.trim() ? { utm_campaign: form.utm_campaign.trim() } : {}),
      forward_query_parameters_is_enabled: form.forward_query_parameters_is_enabled,
      http_status_code: form.http_status_code
    };
    const endpoint = editing ? `/api/short-links/${editing.id}` : "/api/short-links";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(body.code ?? body.error ?? "shortener_api_failed");
    }
  }

  async function onSubmit() {
    try {
      await createOrUpdate();
      toast.success(editing ? "Short link updated" : "Short link created");
      setOpenCreate(false);
      setEditing(null);
      setForm(DEFAULT_FORM);
      await loadLinks();
    } catch (error) {
      toast.error("Short link action failed", error instanceof Error ? error.message : "shortener_api_failed");
    }
  }

  async function onDelete(item: ShortLinkItem) {
    const approved = await confirm({
      title: "Delete short link?",
      message: "This action cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "danger"
    });
    if (!approved) return;
    const response = await fetch(`/api/short-links/${item.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      toast.error("Delete failed", body.code ?? body.error ?? "shortener_api_failed");
      return;
    }
    toast.success("Short link deleted");
    await loadLinks();
  }

  async function toggleEnabled(item: ShortLinkItem) {
    const response = await fetch(`/api/short-links/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_enabled: !item.enabled })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      toast.error("Update failed", body.code ?? body.error ?? "shortener_api_failed");
      return;
    }
    toast.success(item.enabled ? "Short link disabled" : "Short link enabled");
    await loadLinks();
  }

  const topClicked = useMemo(() => [...items].sort((a, b) => b.clicks - a.clicks).slice(0, 5), [items]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card title="Total links" value={stats.totalLinks} />
        <Card title="Total clicks" value={stats.totalClicks} />
        <Card title="Last created" value={stats.lastCreated?.createdAt ? new Date(stats.lastCreated.createdAt).toLocaleString() : "-"} />
        <Card title="Top clicked" value={stats.top ? `${stats.top.shortUrl} (${stats.top.clicks})` : "-"} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="Search" value={filters.search} onChange={(e) => setFilters((s) => ({ ...s, search: e.target.value }))} />
          <select className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.search_by} onChange={(e) => setFilters((s) => ({ ...s, search_by: e.target.value }))}>
            <option value="url">Search by short URL</option>
            <option value="location_url">Search by destination</option>
          </select>
          <select className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.is_enabled} onChange={(e) => setFilters((s) => ({ ...s, is_enabled: e.target.value }))}>
            <option value="all">Enabled: all</option>
            <option value="1">Enabled only</option>
            <option value="0">Disabled only</option>
          </select>
          <select className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.type} onChange={(e) => setFilters((s) => ({ ...s, type: e.target.value }))}>
            <option value="">Type: all</option>
            <option value="redirect">redirect</option>
            <option value="frame">frame</option>
          </select>
          <select className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.order_by} onChange={(e) => setFilters((s) => ({ ...s, order_by: e.target.value }))}>
            <option value="clicks">Order: clicks</option>
            <option value="datetime_create">Order: created date</option>
            <option value="url">Order: URL</option>
          </select>
          <input type="datetime-local" className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.datetime_start} onChange={(e) => setFilters((s) => ({ ...s, datetime_start: e.target.value }))} />
          <input type="datetime-local" className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.datetime_end} onChange={(e) => setFilters((s) => ({ ...s, datetime_end: e.target.value }))} />
          <select className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={String(resultsPerPage)} onChange={(e) => setResultsPerPage(Number(e.target.value))}>
            <option value="10">10 rows</option>
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
          </select>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm" onClick={() => void loadLinks()}>
              <RefreshCcw className="h-4 w-4" />
              Refresh stats
            </button>
            <button
              className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm text-white"
              onClick={() => {
                setEditing(null);
                setForm(DEFAULT_FORM);
                setOpenCreate(true);
              }}
            >
              <Link2 className="h-4 w-4" />
              Create link
            </button>
          </div>
        </div>
        <div className="mt-2">
          <button className="rounded border border-border px-3 py-1 text-xs text-zinc-300" onClick={() => { setPage(1); void loadLinks(); }}>
            Apply filters
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="p-6 text-sm text-zinc-400">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading short links...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Short URL</th>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Clicks</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Last activity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-border hover:bg-zinc-900/30">
                    <td className="px-3 py-2 text-zinc-100">{item.shortUrl}</td>
                    <td className="max-w-[420px] truncate px-3 py-2 text-zinc-300" title={item.destinationUrl}>{item.destinationUrl}</td>
                    <td className="px-3 py-2">{item.clicks}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400">{item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400">{item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleString() : "-"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={item.enabled ? "enabled" : "disabled"} tone={item.enabled ? "success" : "muted"} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button className="rounded border border-border px-2 py-1 text-xs" onClick={async () => { await navigator.clipboard.writeText(item.shortUrl); toast.success("Short URL copied"); }}>
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button className="rounded border border-border px-2 py-1 text-xs" onClick={() => { setEditing(item); setForm({ ...DEFAULT_FORM, location_url: item.destinationUrl, url: item.alias ?? "" }); setOpenCreate(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="rounded border border-border px-2 py-1 text-xs"
                          onClick={async () => {
                            const res = await fetch(`/api/short-links/${item.id}`, { cache: "no-store" });
                            const body = await res.json().catch(() => ({}));
                            if (!res.ok || body.ok === false) {
                              toast.error("Link detail could not be loaded", body.code ?? body.error ?? "shortener_api_failed");
                              return;
                            }
                            setDetailData(body?.data ?? body);
                            setDetailOpen(true);
                          }}
                        >
                          View
                        </button>
                        <button className="rounded border border-border px-2 py-1 text-xs" onClick={() => void toggleEnabled(item)}>
                          {item.enabled ? "Disable" : "Enable"}
                        </button>
                        <button className="rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-300" onClick={() => void onDelete(item)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-zinc-300">
          <p>Page {page} · Total {total}</p>
          <div className="flex gap-2">
            <button className="rounded border border-border px-2 py-1 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <button className="rounded border border-border px-2 py-1 disabled:opacity-50" disabled={page * resultsPerPage >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-3">
        <p className="text-xs uppercase tracking-wide text-zinc-400">Top clicked links</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {topClicked.map((item) => (
            <div key={item.id} className="rounded border border-border bg-zinc-900/40 p-2 text-xs text-zinc-300">
              <p className="truncate text-zinc-100">{item.shortUrl}</p>
              <p className="truncate text-zinc-400">{item.destinationUrl}</p>
              <p className="mt-1">Clicks: {item.clicks}</p>
            </div>
          ))}
          {topClicked.length === 0 ? <p className="text-xs text-zinc-500">No links yet.</p> : null}
        </div>
      </section>

      {openCreate ? (
        <OverlayPortal active={openCreate} lockScroll>
          <div className="fixed inset-0 z-50 bg-black/60 p-4" onClick={() => setOpenCreate(false)}>
            <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-white">{editing ? "Edit short link" : "Create short link"}</p>
              <div className="mt-3 grid gap-2">
                <input className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="Destination URL (required)" value={form.location_url} onChange={(e) => setForm((s) => ({ ...s, location_url: e.target.value }))} />
                <input className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="Custom alias (optional)" value={form.url} onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))} />
                <div className="grid gap-2 md:grid-cols-3">
                  <input className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="UTM source" value={form.utm_source} onChange={(e) => setForm((s) => ({ ...s, utm_source: e.target.value }))} />
                  <input className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="UTM medium" value={form.utm_medium} onChange={(e) => setForm((s) => ({ ...s, utm_medium: e.target.value }))} />
                  <input className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="UTM campaign" value={form.utm_campaign} onChange={(e) => setForm((s) => ({ ...s, utm_campaign: e.target.value }))} />
                </div>
                <select className="rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={String(form.http_status_code)} onChange={(e) => setForm((s) => ({ ...s, http_status_code: Number(e.target.value) as 301 | 302 | 307 | 308 }))}>
                  <option value="301">301</option>
                  <option value="302">302</option>
                  <option value="307">307</option>
                  <option value="308">308</option>
                </select>
                <label className="flex items-center gap-2 rounded border border-border bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
                  <input type="checkbox" checked={form.forward_query_parameters_is_enabled} onChange={(e) => setForm((s) => ({ ...s, forward_query_parameters_is_enabled: e.target.checked }))} />
                  Forward query parameters
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="rounded bg-accent px-3 py-2 text-sm text-white" onClick={() => void onSubmit()}>
                  {editing ? "Save" : "Create"}
                </button>
                <button className="rounded border border-border px-3 py-2 text-sm text-zinc-300" onClick={() => setOpenCreate(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}
      {detailOpen ? (
        <OverlayPortal active={detailOpen} lockScroll>
          <div className="fixed inset-0 z-50 bg-black/60 p-4" onClick={() => setDetailOpen(false)}>
            <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-white">Short link detail</p>
              <pre className="mt-2 overflow-auto rounded border border-border bg-zinc-900/40 p-3 text-xs text-zinc-300">
                {JSON.stringify(detailData, null, 2)}
              </pre>
              <div className="mt-3">
                <button className="rounded border border-border px-3 py-2 text-sm text-zinc-300" onClick={() => setDetailOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      ) : null}
    </div>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-xs text-zinc-400">{title}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

