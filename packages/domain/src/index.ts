export enum CampaignStatus {
  PENDING = "pending",
  QUEUED = "queued",
  RUNNING = "running",
  PAUSED = "paused",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELED = "canceled",
  PARTIALLY_COMPLETED = "partially_completed"
}

export enum RecipientStatus {
  ACTIVE = "active",
  UNSUBSCRIBED = "unsubscribed",
  BOUNCED = "bounced",
  COMPLAINED = "complained",
  INVALID = "invalid",
  BLOCKED = "blocked"
}

export type TrackingKind = "open" | "click" | "unsubscribe";

export type FairSchedulerSlot = {
  campaignId: string;
  smtpAccountId: string;
  provider: string;
  remaining: number;
  priority: number;
};

export type EffectiveRateDecision = {
  effectiveRatePerSecond: number;
  reasons: string[];
  warmupTierName?: string;
  nextTierName?: string;
};
