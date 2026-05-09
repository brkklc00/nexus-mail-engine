"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Link2, Loader2, RefreshCcw, Trash2 } from "lucide-react";
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

const SHORT_BASE = (process.env.NEXT_PUBLIC_NXUSURL_API_BASE ?? process.env.NEXT_PUBLIC_NXUSURL_BASE ?? "https://nxusurl.co")
  .trim()
  .replace(/\/+$/, "");

function composeFullShortUrl(input: string) {
  const raw = (input ?? "").trim();
  if (!raw) return SHORT_BASE;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SHORT_BASE}/${raw.replace(/^\/+/, "")}`;
}

function getAliasFromUrl(raw: string) {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.pathname.replace(/^\/+/, "");
    } catch {
      return "";
    }
  }
  return value.replace(/^\/+/, "");
}

function normalizeItem(raw: any): ShortLinkItem {
  const alias = raw?.alias ? String(raw.alias) : getAliasFromUrl(String(raw?.url ?? raw?.short_url ?? raw?.shortUrl ?? ""));
  const fullShortUrl = composeFullShortUrl(String(raw?.shortUrl ?? raw?.url ?? raw?.short_url ?? alias ?? ""));
  return {
    id: String(raw?.id ?? raw?.link_id ?? ""),
    shortUrl: fullShortUrl,
    alias: alias || null,
    destinationUrl: String(raw?.location_url ?? raw?.destination_url ?? raw?.locationUrl ?? ""),
    clicks: Number(raw?.clicks ?? raw?.click_count ?? 0),
    enabled: raw?.is_enabled === false ? false : true,
    type: raw?.type ? String(raw.type) : null
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
  const [editing, setEditing] = useState<ShortLinkItem | null>(null);
  const [createdShortUrl, setCreatedShortUrl] = useState<string | null>(null);
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
      toast.error("Kisa linkler yuklenemedi", error instanceof Error ? error.message : "shortener_api_failed");
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
    return {
      totalLinks: total,
      totalClicks
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
    const body = (await response.json().catch(() => ({}))) as any;
    if (!response.ok || body.ok === false) {
      throw new Error(body.code ?? body.error ?? "shortener_api_failed");
    }
    return normalizeItem(body?.data ?? body);
  }

  async function onSubmit() {
    try {
      const saved = await createOrUpdate();
      toast.success(editing ? "Kisa link guncellendi" : "Kisa link olusturuldu");
      setCreatedShortUrl(saved.shortUrl);
      if (editing) {
        setOpenCreate(false);
      }
      setEditing(null);
      setForm((prev) => ({ ...prev, location_url: "", url: "", utm_source: "", utm_medium: "", utm_campaign: "" }));
      await loadLinks();
    } catch (error) {
      toast.error("Kisa link islemi basarisiz", error instanceof Error ? error.message : "shortener_api_failed");
    }
  }

  async function onDelete(item: ShortLinkItem) {
    const approved = await confirm({
      title: "Kisa link silinsin mi?",
      message: "This action cannot be undone.",
      confirmLabel: "Sil",
      cancelLabel: "Iptal",
      tone: "danger"
    });
    if (!approved) return;
    const response = await fetch(`/api/short-links/${item.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      toast.error("Silme islemi basarisiz", body.code ?? body.error ?? "shortener_api_failed");
      return;
    }
    toast.success("Kisa link silindi");
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
      toast.error("Guncelleme basarisiz", body.code ?? body.error ?? "shortener_api_failed");
      return;
    }
    toast.success(item.enabled ? "Kisa link devre disi birakildi" : "Kisa link aktif edildi");
    await loadLinks();
  }

  const aliasPreview = form.url.trim();
  const previewShortUrl = composeFullShortUrl(aliasPreview);
  const editingBaseUrl = editing ? composeFullShortUrl(editing.alias ?? getAliasFromUrl(editing.shortUrl)) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card title="Toplam link" value={stats.totalLinks} />
        <Card title="Toplam tiklama" value={stats.totalClicks} />
        <Card title="Shortener base" value={SHORT_BASE} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div>
            <p className="mb-1 text-xs text-zinc-400">Arama</p>
            <input className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="Ara" value={filters.search} onChange={(e) => setFilters((s) => ({ ...s, search: e.target.value }))} />
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Arama turu</p>
            <select className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.search_by} onChange={(e) => setFilters((s) => ({ ...s, search_by: e.target.value }))}>
              <option value="url">Kisa URL</option>
              <option value="location_url">Hedef URL</option>
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Durum</p>
            <select className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.is_enabled} onChange={(e) => setFilters((s) => ({ ...s, is_enabled: e.target.value }))}>
              <option value="all">Tum durumlar</option>
              <option value="1">Sadece aktif</option>
              <option value="0">Sadece pasif</option>
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Link tipi</p>
            <select className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.type} onChange={(e) => setFilters((s) => ({ ...s, type: e.target.value }))}>
              <option value="">Tum tipler</option>
              <option value="redirect">redirect</option>
              <option value="frame">frame</option>
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Siralama</p>
            <select className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.order_by} onChange={(e) => setFilters((s) => ({ ...s, order_by: e.target.value }))}>
              <option value="clicks">Tiklama</option>
              <option value="datetime_create">Olusturma tarihi</option>
              <option value="url">URL</option>
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Baslangic tarihi</p>
            <input type="datetime-local" className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.datetime_start} onChange={(e) => setFilters((s) => ({ ...s, datetime_start: e.target.value }))} />
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Bitis tarihi</p>
            <input type="datetime-local" className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={filters.datetime_end} onChange={(e) => setFilters((s) => ({ ...s, datetime_end: e.target.value }))} />
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Sayfa basina</p>
            <select className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={String(resultsPerPage)} onChange={(e) => setResultsPerPage(Number(e.target.value))}>
              <option value="10">10 satir</option>
              <option value="25">25 satir</option>
              <option value="50">50 satir</option>
              <option value="100">100 satir</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm" onClick={() => void loadLinks()}>
              <RefreshCcw className="h-4 w-4" />
              Yenile
            </button>
            <button
              className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm text-white"
              onClick={() => {
                setCreatedShortUrl(null);
                setEditing(null);
                setForm(DEFAULT_FORM);
                setOpenCreate(true);
              }}
            >
              <Link2 className="h-4 w-4" />
              Link olustur
            </button>
          </div>
        </div>
        <div className="mt-2">
          <button className="rounded border border-border px-3 py-1 text-xs text-zinc-300" onClick={() => { setPage(1); void loadLinks(); }}>
            Filtreleri uygula
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
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-border hover:bg-zinc-900/30">
                    <td className="max-w-[320px] truncate px-3 py-2 text-zinc-100" title={item.shortUrl}>
                      {item.shortUrl}
                    </td>
                    <td className="max-w-[420px] truncate px-3 py-2 text-zinc-300" title={item.destinationUrl}>{item.destinationUrl}</td>
                    <td className="px-3 py-2">{item.clicks}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={item.enabled ? "enabled" : "disabled"} tone={item.enabled ? "success" : "muted"} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button className="rounded border border-border px-2 py-1 text-xs" onClick={async () => { await navigator.clipboard.writeText(item.shortUrl); toast.success("Kisa URL kopyalandi"); }}>
                          Copy
                        </button>
                        <button className="rounded border border-border px-2 py-1 text-xs" onClick={() => { setCreatedShortUrl(null); setEditing(item); setForm({ ...DEFAULT_FORM, location_url: item.destinationUrl, url: item.alias ?? getAliasFromUrl(item.shortUrl) }); setOpenCreate(true); }}>
                          Edit
                        </button>
                        <button
                          className="rounded border border-border px-2 py-1 text-xs"
                          onClick={() => window.open(item.shortUrl, "_blank", "noopener,noreferrer")}
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

      {openCreate ? (
        <OverlayPortal active={openCreate} lockScroll>
          <div className="fixed inset-0 z-50 bg-black/60 p-4" onClick={() => setOpenCreate(false)}>
            <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-white">{editing ? "Kisa link duzenle" : "Kisa link olustur"}</p>
              <div className="mt-3 grid gap-2">
                <label className="space-y-1">
                  <span className="text-xs text-zinc-400">Hedef URL</span>
                  <input className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="Destination URL (required)" value={form.location_url} onChange={(e) => setForm((s) => ({ ...s, location_url: e.target.value }))} />
                  <p className="text-[11px] text-zinc-500">Kullanici bu adrese yonlendirilir.</p>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-zinc-400">Kisa link adi / Alias</span>
                  <input className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="Custom alias (optional)" value={form.url} onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))} />
                  <p className="text-[11px] text-zinc-500">Bos birakirsaniz sistem otomatik kisa link olusturur.</p>
                </label>
                <div className="rounded border border-border bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
                  <p className="text-zinc-400">Short URL preview</p>
                  <p className="mt-1 truncate text-zinc-100" title={aliasPreview ? previewShortUrl : editingBaseUrl ?? previewShortUrl}>
                    {aliasPreview ? previewShortUrl : editingBaseUrl ?? previewShortUrl}
                  </p>
                </div>
                {!editing && createdShortUrl ? (
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                    <p>Created short URL</p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="truncate" title={createdShortUrl}>{createdShortUrl}</p>
                      <button
                        className="rounded border border-emerald-400/60 px-2 py-1 text-[11px]"
                        onClick={async () => {
                          await navigator.clipboard.writeText(createdShortUrl);
                          toast.success("Kisa URL kopyalandi");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2 md:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-xs text-zinc-400">UTM Source</span>
                    <input className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="UTM source" value={form.utm_source} onChange={(e) => setForm((s) => ({ ...s, utm_source: e.target.value }))} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-zinc-400">UTM Medium</span>
                    <input className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="UTM medium" value={form.utm_medium} onChange={(e) => setForm((s) => ({ ...s, utm_medium: e.target.value }))} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-zinc-400">UTM Campaign</span>
                    <input className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" placeholder="UTM campaign" value={form.utm_campaign} onChange={(e) => setForm((s) => ({ ...s, utm_campaign: e.target.value }))} />
                  </label>
                </div>
                <label className="space-y-1">
                  <span className="text-xs text-zinc-400">Yonlendirme kodu</span>
                  <select className="w-full rounded border border-border bg-zinc-900 px-3 py-2 text-sm" value={String(form.http_status_code)} onChange={(e) => setForm((s) => ({ ...s, http_status_code: Number(e.target.value) as 301 | 302 | 307 | 308 }))}>
                    <option value="301">301</option>
                    <option value="302">302</option>
                    <option value="307">307</option>
                    <option value="308">308</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 rounded border border-border bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
                  <input type="checkbox" checked={form.forward_query_parameters_is_enabled} onChange={(e) => setForm((s) => ({ ...s, forward_query_parameters_is_enabled: e.target.checked }))} />
                  Query parametrelerini aktar
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="rounded bg-accent px-3 py-2 text-sm text-white" onClick={() => void onSubmit()}>
                  {editing ? "Kaydet" : "Olustur"}
                </button>
                <button className="rounded border border-border px-3 py-2 text-sm text-zinc-300" onClick={() => { setOpenCreate(false); setCreatedShortUrl(null); }}>
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

function Card({ title, value, tooltip }: { title: string; value: string | number; tooltip?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3" title={tooltip}>
      <p className="text-xs text-zinc-400">{title}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

