export type CampaignStatus =
  | "pending"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"
  | "partially_completed"
  | string;

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  template: { id: string; title: string } | null;
  list: { id: string; name: string } | null;
  segment: { id: string; name: string } | null;
  smtp: { id: string; name: string } | null;
  targetedCount: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  openCount: number;
  clickCount: number;
  progress: number;
  createdAt: string;
  lastActivity: string | null;
};

export type ListStats = {
  totalCampaigns: number;
  runningCampaigns: number;
  pausedCampaigns: number;
  completedCampaigns: number;
  canceledCampaigns: number;
  totalTargeted: number;
  totalSent: number;
  totalFailed: number;
  totalSkipped: number;
  totalOpened: number;
  totalClicked: number;
  averageDeliveryRate: number;
  queue: {
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
    retryWaiting: number;
    deadWaiting: number;
  };
};

export type FilterOptions = {
  templates: Array<{ id: string; title: string }>;
  lists: Array<{ id: string; name: string }>;
  segments: Array<{ id: string; name: string }>;
  smtpAccounts: Array<{ id: string; name: string }>;
};

export type CampaignListResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  items: CampaignRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats?: ListStats;
  filters: FilterOptions;
};

export type QueueAdminAction =
  | "pause"
  | "resume"
  | "clean_stale_campaign_jobs"
  | "clean_failed"
  | "clean_completed";

export type QueueAdminResponse = {
  ok: boolean;
  action?: QueueAdminAction;
  scanned?: number;
  cleaned?: number;
  skippedActive?: number;
  skippedUnknown?: number;
  remaining?: number;
  progress?: {
    scanned: number;
    cleaned: number;
    skippedActive: number;
    skippedUnknown: number;
    remaining: number;
  };
  queueCounts?: {
    campaign?: Record<string, number>;
    delivery?: Record<string, number>;
    retry?: Record<string, number>;
    dead?: Record<string, number>;
  };
  error?: string;
};
