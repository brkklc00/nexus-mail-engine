import crypto from "node:crypto";
import { prisma } from "@nexus/db";

export type ShortenerErrorCode =
  | "shortener_not_configured"
  | "shortener_auth_failed"
  | "shortener_api_failed"
  | "invalid_destination_url"
  | "duplicate_alias"
  | "link_not_found";

const BLOCKED_PROTOCOLS = new Set(["javascript:", "data:", "file:"]);

type NxusurlConfig = {
  baseUrl: string;
  apiKey: string;
};

function shortenerBaseUrl(): string {
  return (process.env.NXUSURL_API_BASE ?? "https://nxusurl.co").trim().replace(/\/+$/, "");
}

function readConfig(): NxusurlConfig | null {
  const baseUrl = (process.env.NXUSURL_API_BASE ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.NXUSURL_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export function getShortenerStatus() {
  const config = readConfig();
  return {
    configured: Boolean(config),
    baseUrl: config?.baseUrl ?? process.env.NXUSURL_API_BASE ?? ""
  };
}

export function assertSafeDestinationUrl(input: string): string {
  const value = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid_destination_url");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (!["http:", "https:"].includes(protocol) || BLOCKED_PROTOCOLS.has(protocol)) {
    throw new Error("invalid_destination_url");
  }
  return parsed.toString();
}

function asErrorCodeFromRemote(status: number, body: any): ShortenerErrorCode {
  const raw = `${body?.message ?? ""} ${body?.error ?? ""}`.toLowerCase();
  if (status === 401 || status === 403) return "shortener_auth_failed";
  if (status === 404) return "link_not_found";
  if (raw.includes("alias") && raw.includes("exist")) return "duplicate_alias";
  return "shortener_api_failed";
}

async function requestNxusurl(path: string, init: RequestInit & { body?: BodyInit | null } = {}) {
  const config = readConfig();
  if (!config) {
    throw new Error("shortener_not_configured");
  }
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(asErrorCodeFromRemote(response.status, payload));
  }
  return payload;
}

export async function listShortLinks(searchParams: URLSearchParams) {
  return requestNxusurl(`/api/links/?${searchParams.toString()}`, { method: "GET" });
}

type LinkPayload = {
  location_url: string;
  url?: string;
  domain_id?: number;
  project_id?: number;
  is_enabled?: boolean;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  forward_query_parameters_is_enabled?: boolean;
  http_status_code?: 301 | 302 | 307 | 308;
};

function toFormData(payload: Partial<LinkPayload>, requireLocationUrl: boolean): FormData {
  const form = new FormData();
  if (payload.location_url) {
    form.set("location_url", assertSafeDestinationUrl(payload.location_url));
  } else if (requireLocationUrl) {
    throw new Error("invalid_destination_url");
  }
  if (payload.url) form.set("url", payload.url);
  if (typeof payload.domain_id === "number") form.set("domain_id", String(payload.domain_id));
  if (typeof payload.project_id === "number") form.set("project_id", String(payload.project_id));
  if (typeof payload.is_enabled === "boolean") form.set("is_enabled", payload.is_enabled ? "1" : "0");
  if (payload.utm_source) form.set("utm_source", payload.utm_source);
  if (payload.utm_medium) form.set("utm_medium", payload.utm_medium);
  if (payload.utm_campaign) form.set("utm_campaign", payload.utm_campaign);
  if (typeof payload.forward_query_parameters_is_enabled === "boolean") {
    form.set("forward_query_parameters_is_enabled", payload.forward_query_parameters_is_enabled ? "1" : "0");
  }
  if (payload.http_status_code) form.set("http_status_code", String(payload.http_status_code));
  return form;
}

async function upsertShortLinkCache(entry: {
  externalId: string;
  shortUrl: string;
  alias: string | null;
  destinationUrl: string;
  clicks: number;
  campaignId?: string | null;
  templateId?: string | null;
}) {
  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "ShortLinkCache"
      ("id","externalId","shortUrl","alias","destinationUrl","clicks","campaignId","templateId","createdAt","updatedAt","lastSyncedAt")
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),now())
      ON CONFLICT ("externalId")
      DO UPDATE SET
        "shortUrl"=EXCLUDED."shortUrl",
        "alias"=EXCLUDED."alias",
        "destinationUrl"=EXCLUDED."destinationUrl",
        "clicks"=EXCLUDED."clicks",
        "campaignId"=COALESCE(EXCLUDED."campaignId","ShortLinkCache"."campaignId"),
        "templateId"=COALESCE(EXCLUDED."templateId","ShortLinkCache"."templateId"),
        "updatedAt"=now(),
        "lastSyncedAt"=now()
      `,
      crypto.randomUUID(),
      entry.externalId,
      entry.shortUrl,
      entry.alias,
      entry.destinationUrl,
      entry.clicks,
      entry.campaignId ?? null,
      entry.templateId ?? null
    );
  } catch {
    // Cache is best-effort and must not block requests.
  }
}

function normalizeShortLinkResponse(payload: any) {
  const data = payload?.data ?? payload;
  return {
    externalId: String(data?.id ?? data?.link_id ?? ""),
    shortUrl: buildFullShortUrl(data?.url ?? data?.short_url ?? ""),
    alias: data?.alias ? String(data.alias) : normalizeAlias(data?.url ?? data?.short_url ?? ""),
    destinationUrl: String(data?.location_url ?? data?.destination_url ?? ""),
    clicks: Number(data?.clicks ?? 0)
  };
}

function normalizeAlias(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const token = parsed.pathname.replace(/^\/+/, "").trim();
      return token || null;
    } catch {
      return null;
    }
  }
  return value.replace(/^\/+/, "") || null;
}

export function buildFullShortUrl(raw: unknown): string {
  const value = String(raw ?? "").trim();
  const base = shortenerBaseUrl();
  if (!value) return base;
  if (/^https?:\/\//i.test(value)) return value;
  const token = value.replace(/^\/+/, "");
  const baseNoProtocol = base.replace(/^https?:\/\//i, "");
  if (token.toLowerCase().startsWith(baseNoProtocol.toLowerCase())) {
    const scheme = base.startsWith("https://") ? "https://" : "http://";
    return `${scheme}${token}`;
  }
  return `${base}/${token}`;
}

function normalizeShortLinkObject(raw: any) {
  const alias = raw?.alias ? String(raw.alias) : normalizeAlias(raw?.url ?? raw?.short_url ?? raw?.shortUrl ?? "");
  return {
    ...raw,
    alias,
    shortUrl: buildFullShortUrl(raw?.url ?? raw?.short_url ?? raw?.shortUrl ?? alias ?? "")
  };
}

export function normalizeShortLinkPayload(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  const root = payload as any;
  if (Array.isArray(root?.data?.results)) {
    root.data.results = root.data.results.map(normalizeShortLinkObject);
    return root;
  }
  if (Array.isArray(root?.results)) {
    root.results = root.results.map(normalizeShortLinkObject);
    return root;
  }
  if (root?.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    root.data = normalizeShortLinkObject(root.data);
    return root;
  }
  return normalizeShortLinkObject(root);
}

export async function createShortLink(payload: LinkPayload, opts?: { campaignId?: string | null; templateId?: string | null }) {
  const data = await requestNxusurl("/api/links", {
    method: "POST",
    body: toFormData(payload, true)
  });
  const normalized = normalizeShortLinkResponse(data);
  if (normalized.externalId && normalized.shortUrl) {
    await upsertShortLinkCache({
      ...normalized,
      campaignId: opts?.campaignId ?? null,
      templateId: opts?.templateId ?? null
    });
  }
  return data;
}

export async function getShortLink(id: string) {
  const data = await requestNxusurl(`/api/links/${id}`, { method: "GET" });
  const normalized = normalizeShortLinkResponse(data);
  if (normalized.externalId && normalized.shortUrl) {
    await upsertShortLinkCache(normalized);
  }
  return data;
}

export async function updateShortLink(id: string, payload: Partial<LinkPayload>) {
  const bodyPayload = { ...payload } as any;
  if (bodyPayload.location_url) {
    bodyPayload.location_url = assertSafeDestinationUrl(bodyPayload.location_url);
  }
  const data = await requestNxusurl(`/api/links/${id}`, {
    method: "POST",
    body: toFormData(bodyPayload, false)
  });
  const normalized = normalizeShortLinkResponse(data);
  if (normalized.externalId && normalized.shortUrl) {
    await upsertShortLinkCache(normalized);
  }
  return data;
}

export async function deleteShortLink(id: string) {
  return requestNxusurl(`/api/links/${id}`, { method: "DELETE" });
}

export function shouldSkipAutoShorten(url: string) {
  const lower = url.toLowerCase();
  return (
    lower.includes("{{unsubscribe_url}}") ||
    lower.includes("{{tracking_pixel}}") ||
    lower.includes("/track/open/") ||
    lower.includes("/track/click/") ||
    lower.includes("nxusurl.co")
  );
}

export async function autoShortenHtmlLinks(input: {
  html: string;
  campaignName?: string;
  templateName?: string;
  templateId?: string | null;
  campaignId?: string | null;
}) {
  const urlRegex = /href="([^"]+)"/g;
  const urls = Array.from(input.html.matchAll(urlRegex))
    .map((match) => match[1])
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => !shouldSkipAutoShorten(url));
  const uniqueUrls = Array.from(new Set(urls));
  if (uniqueUrls.length === 0) {
    return { html: input.html, mappings: [] as Array<{ originalUrl: string; shortUrl: string; shortLinkId: string }> };
  }

  const mappings: Array<{ originalUrl: string; shortUrl: string; shortLinkId: string }> = [];
  let html = input.html;
  for (const destination of uniqueUrls) {
    const response = await createShortLink(
      {
        location_url: destination,
        utm_source: "nexus-mail",
        utm_medium: "email",
        utm_campaign: input.campaignName ?? input.templateName
      },
      { campaignId: input.campaignId, templateId: input.templateId }
    );
    const normalized = normalizeShortLinkResponse(response);
    if (!normalized.shortUrl || !normalized.externalId) continue;
    html = html.split(destination).join(normalized.shortUrl);
    mappings.push({
      originalUrl: destination,
      shortUrl: normalized.shortUrl,
      shortLinkId: normalized.externalId
    });
  }

  return { html, mappings };
}

