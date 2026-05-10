export type AlibabaSyncErrorKind = {
  retryable: boolean;
  code: string;
  shortMessage: string;
};

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

function norm(s: string) {
  return s.toLowerCase();
}

/** Short user-facing / log message (no secrets, no huge payloads). */
export function truncateMessage(input: string, max = 220) {
  const t = input.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function classifyAlibabaSyncError(input: {
  httpStatus?: number;
  message?: string;
  alibabaCode?: string;
  prismaCode?: string;
  causeMessage?: string;
}): AlibabaSyncErrorKind {
  const msg = norm(input.message ?? "");
  const cause = norm(input.causeMessage ?? "");
  const combined = `${msg} ${cause}`;
  const aliCode = norm(input.alibabaCode ?? "");
  const prismaCode = input.prismaCode ?? "";

  if (prismaCode === "P2024" || prismaCode === "P1001" || prismaCode === "P1017" || prismaCode === "P2034") {
    return { retryable: true, code: `prisma_${prismaCode}`, shortMessage: "Veritabanı bağlantısı geçici olarak kullanılamıyor." };
  }
  if (prismaCode === "P2028") {
    return { retryable: true, code: "prisma_transaction_timeout", shortMessage: "Veritabanı işlemi zaman aşımına uğradı." };
  }

  if (combined.includes("econnreset") || combined.includes("etimedout") || combined.includes("enotfound")) {
    return { retryable: true, code: "network", shortMessage: "Ağ bağlantısı kesildi veya zaman aşımı." };
  }
  if (combined.includes("fetch failed") || combined.includes("socket hang up") || combined.includes("und_err")) {
    return { retryable: true, code: "fetch", shortMessage: "HTTP isteği başarısız oldu." };
  }
  if (combined.includes("redis") && (combined.includes("timeout") || combined.includes("econn"))) {
    return { retryable: true, code: "redis", shortMessage: "Redis geçici hatası." };
  }
  if (combined.includes("transaction") && combined.includes("closed")) {
    return { retryable: true, code: "db_transaction_closed", shortMessage: "Veritabanı oturumu kapandı." };
  }
  if (combined.includes("pool") && combined.includes("timeout")) {
    return { retryable: true, code: "db_pool_timeout", shortMessage: "Veritabanı bağlantı havuzu dolu." };
  }

  const st = input.httpStatus;
  if (typeof st === "number" && RETRYABLE_HTTP.has(st)) {
    return { retryable: true, code: `http_${st}`, shortMessage: `Alibaba HTTP ${st}` };
  }

  if (
    aliCode.includes("throttling") ||
    aliCode.includes("throttle") ||
    aliCode.includes("ratelimit") ||
    aliCode === "serviceunavailable" ||
    msg.includes("rate limit")
  ) {
    return { retryable: true, code: "alibaba_throttle", shortMessage: "Alibaba istek sınırı veya servis yoğun." };
  }

  if (
    aliCode.includes("signature") ||
    combined.includes("signature") ||
    aliCode.includes("invalidaccesskeyid") ||
    combined.includes("invalidaccesskeyid") ||
    aliCode.includes("signaturedoesnotmatch") ||
    combined.includes("missing authentication token")
  ) {
    return { retryable: false, code: "alibaba_auth", shortMessage: "Alibaba kimlik veya imza hatası." };
  }

  if (
    aliCode.includes("invaliddate") ||
    combined.includes("invaliddate") ||
    combined.includes("malformed") ||
    msg.includes("invalid date")
  ) {
    return { retryable: false, code: "alibaba_invalid_date", shortMessage: "Geçersiz tarih aralığı veya biçim." };
  }

  if (aliCode.includes("missing") && (msg.includes("parameter") || combined.includes("required"))) {
    return { retryable: false, code: "alibaba_config", shortMessage: "Eksik veya hatalı Alibaba parametresi." };
  }

  if (typeof st === "number" && (st === 401 || st === 403)) {
    return { retryable: false, code: `http_${st}`, shortMessage: "Yetkilendirme reddedildi." };
  }

  if (typeof st === "number" && st >= 400 && st < 500 && !RETRYABLE_HTTP.has(st)) {
    return { retryable: false, code: `http_${st}`, shortMessage: `Alibaba HTTP ${st}` };
  }

  if (msg || aliCode) {
    return { retryable: true, code: "unknown_transient", shortMessage: truncateMessage(input.message || input.alibabaCode || "Bilinmeyen hata") };
  }

  return { retryable: true, code: "unknown", shortMessage: "Bilinmeyen hata" };
}

export function isRetryableFailureCode(code: string | null | undefined): boolean {
  if (!code) return false;
  if (code === "unknown" || code === "unknown_transient") return true;
  if (code.startsWith("http_")) {
    const n = Number(code.replace("http_", ""));
    return RETRYABLE_HTTP.has(n);
  }
  if (code.startsWith("prisma_")) return true;
  return ["network", "fetch", "redis", "db_transaction_closed", "db_pool_timeout", "alibaba_throttle"].includes(code);
}
