import type { CampaignStatus } from "./campaign-dashboard-types";

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  queued: "Kuyrukta",
  running: "Çalışıyor",
  paused: "Duraklatıldı",
  completed: "Tamamlandı",
  partially_completed: "Kısmen Tamamlandı",
  failed: "Başarısız",
  canceled: "İptal Edildi"
};

export const INT_FORMATTER = new Intl.NumberFormat("tr-TR");

export function fmtInt(value: number): string {
  return INT_FORMATTER.format(value ?? 0);
}

export function fmtDate(input: string | null): string {
  if (!input) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

export function getCampaignStatusLabel(status: string): string {
  return CAMPAIGN_STATUS_LABELS[status] ?? status;
}

/** Pill tone: success | danger | warning | info | muted */
export function toneForCampaignStatus(status: string): "success" | "danger" | "warning" | "info" | "muted" {
  if (status === "running") return "success";
  if (status === "completed") return "success";
  if (status === "partially_completed") return "info";
  if (status === "failed" || status === "canceled") return "danger";
  if (status === "paused") return "warning";
  if (status === "pending" || status === "queued") return "warning";
  return "muted";
}

export function shortCampaignRef(createdAt: string, id: string): string {
  const d = new Date(createdAt);
  if (!Number.isNaN(d.getTime())) {
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}${mm}${dd}`;
  }
  return id.replace(/-/g, "").slice(0, 6);
}

export function availableCampaignRowActions(
  status: CampaignStatus
): Array<"start" | "pause" | "resume" | "cancel" | "report" | "delete" | "view"> {
  if (status === "running") return ["pause", "cancel", "view", "report", "delete"];
  if (status === "paused") return ["resume", "cancel", "view", "report"];
  if (status === "pending") return ["start", "cancel", "view"];
  if (status === "queued") return ["start", "cancel", "view", "delete"];
  if (status === "completed" || status === "partially_completed") return ["view", "report", "delete"];
  if (status === "canceled") return ["view", "delete"];
  if (status === "failed") return ["view", "report", "delete"];
  return ["view"];
}
