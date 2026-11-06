export type Role = "boss" | "admin" | "assistant" | "ops" | "editor" | "cs" | "cs_supervisor";
export type ReviewStatus = "pending" | "approved" | "rejected";

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
};

let csrfToken = "";

async function requestInner<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include"
  });
  const text = await response.text();
  let data: { error?: string; code?: string; csrfToken?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(response.ok ? "服务器返回无法解析的响应" : `请求失败（${response.status}）`);
    }
  }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`) as Error & { code?: string; status?: number };
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data as T;
}

export async function loadCsrf(): Promise<void> {
  const data = await requestInner<{ csrfToken: string }>("/api/auth/csrf");
  csrfToken = data.csrfToken;
}

export const api = {
  loadCsrf,
  login: (username: string, password: string) =>
    requestInner<{ user: User; csrfToken: string; today?: string; timezone?: string; backfillDays?: number; disclaimer?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  logout: () => requestInner("/api/auth/logout", { method: "POST" }),
  me: () => requestInner<{ user: User; today?: string; timezone?: string; backfillDays?: number; disclaimer?: string }>("/api/auth/me"),
  meta: () =>
    requestInner<{ today: string; timezone: string; backfillDays: number; disclaimer: string }>("/api/auth/meta"),
  changePassword: (currentPassword: string, newPassword: string) =>
    requestInner("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    }),
  myFanReports: () => requestInner<{ reports: FanReport[] }>("/api/fan-reports/me"),
  saveFanReport: (payload: { addedCount: number; businessDate?: string; userId?: string }) =>
    requestInner<{ report: FanReport; revised: boolean }>("/api/fan-reports", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  fanSummary: (date: string, teamId?: string) =>
    requestInner<{ date: string; teams: FanSummary[] }>(
      `/api/fan-reports/summary?date=${encodeURIComponent(date)}${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""}`
    ),
  fanExportUrl: (date: string) => `/api/fan-reports/export?date=${encodeURIComponent(date)}`,
  opsReports: () => requestInner<{ reports: OpsReport[] }>("/api/ops-reports"),
  saveOps: (payload: Record<string, unknown>) =>
    requestInner("/api/ops-reports", { method: "PUT", body: JSON.stringify(payload) }),
  editorReports: () => requestInner<{ reports: EditorReport[] }>("/api/editor-reports"),
  editorSummary: (from?: string, to?: string) =>
    requestInner<{ shootCount: number; finishedCount: number; publishedCount: number; endingInventory: number; note: string }>(
      `/api/editor-reports/summary?from=${from ?? ""}&to=${to ?? ""}`
    ),
  saveEditor: (payload: Record<string, unknown>) =>
    requestInner("/api/editor-reports", { method: "PUT", body: JSON.stringify(payload) }),
  orders: () => requestInner<{ orders: Order[] }>("/api/orders"),
  createOrder: (payload: Record<string, unknown>) =>
    requestInner("/api/orders", { method: "POST", body: JSON.stringify(payload) }),
  dashboard: (preset: string, reviewStatus?: string) =>
    requestInner<{
      period: { from: string; to: string };
      metrics: Metrics;
      disclaimer: string;
      formula: string;
      selectedReviewStatus?: ReviewStatus;
      dailyByReviewStatus?: Record<ReviewStatus, DailyReviewMetrics>;
      overallSalary?: { allocated: string; note: string };
      estimateNote?: string;
    }>(`/api/dashboard/summary?preset=${preset}${reviewStatus ? `&reviewStatus=${encodeURIComponent(reviewStatus)}` : ""}`),
  reviews: (status?: string) =>
    requestInner<{ items: ReviewItem[] }>(`/api/reviews${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  reviewHistory: (entityType: string, id: string) =>
    requestInner<{ history: ReviewHistoryItem[] }>(`/api/reviews/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/history`),
  decideReview: (payload: { entityType: string; entityId: string; action: "approve" | "reject"; version: number; reason?: string }) =>
    requestInner<{ item: ReviewItem; message: string }>("/api/reviews", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  teams: () => requestInner<{ teams: Team[] }>("/api/admin/teams"),
  createTeam: (payload: Record<string, unknown>) =>
    requestInner("/api/admin/teams", { method: "POST", body: JSON.stringify(payload) }),
  users: () => requestInner<{ users: AdminUser[] }>("/api/admin/users"),
  createUser: (payload: Record<string, unknown>) =>
    requestInner("/api/admin/users", { method: "POST", body: JSON.stringify(payload) }),
  transferUser: (id: string, payload: Record<string, unknown>) =>
    requestInner(`/api/admin/users/${id}/transfer`, { method: "POST", body: JSON.stringify(payload) }),
  grantScope: (id: string, payload: Record<string, unknown>) =>
    requestInner(`/api/admin/users/${id}/scopes`, { method: "POST", body: JSON.stringify(payload) }),
  salaries: () => requestInner<{ salaries: Salary[] }>("/api/salaries"),
  createSalary: (payload: Record<string, unknown>) =>
    requestInner("/api/salaries", { method: "POST", body: JSON.stringify(payload) }),
  notes: (date: string) => requestInner<{ notes: Note[] }>(`/api/notes?date=${encodeURIComponent(date)}`),
  createNote: (payload: Record<string, unknown>) =>
    requestInner("/api/notes", { method: "POST", body: JSON.stringify(payload) })
};

export type ReviewFields = {
  reviewStatus?: ReviewStatus;
  reviewVersion?: number;
  reviewReason?: string | null;
  reviewedAt?: string | null;
};

export type FanReport = {
  id: string;
  businessDate: string;
  addedCount: number;
  updatedAt: string;
} & ReviewFields;

export type FanSummary = {
  teamId: string;
  teamName: string;
  totalAdded: number;
  expectedCount: number;
  reportedCount: number;
  missingCount: number;
  missing: { userId: string; displayName: string }[];
  details: {
    userId: string;
    displayName: string;
    addedCount: number | null;
    status: "reported" | "missing";
    updatedAt: string | null;
    reviewStatus?: ReviewStatus | null;
  }[];
  reviewCounts?: { pending: number; approved: number; rejected: number };
};

export type OpsReport = {
  id: string;
  businessDate: string;
  platform: string;
  promoVideoCount: number;
  promoCost: string;
  note?: string;
} & ReviewFields;

export type EditorReport = {
  id: string;
  businessDate: string;
  shootCount: number;
  finishedCount: number;
  publishedCount: number;
  inventorySnapshot: number;
  inventoryAdjusted: boolean;
} & ReviewFields;

export type Order = {
  id: string;
  businessDate: string;
  orderRef: string;
  customerLabel?: string | null;
  amount: string;
  status: string;
  isCustom: boolean;
  customProductCost: string;
  laborCost: string;
  shippingCost: string;
} & ReviewFields;

export type Metrics = {
  revenue: string;
  refunds: string;
  promoCost: string;
  salaryAllocated: string;
  customProductCost: string;
  laborCost: string;
  shippingCost: string;
  estimate: string;
  orderCount: number;
  promoVideoCount: number;
  shootCount: number;
  finishedCount: number;
  publishedCount: number;
  endingInventory: number;
  fanAddedTotal: number;
};

export type Team = { id: string; name: string; wechatGroupNote?: string | null };
export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  currentTeam?: { id: string; name: string } | null;
};
export type Salary = {
  id: string;
  userId: string;
  displayName: string;
  monthlyAmount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};
export type Note = { id: string; authorName: string; targetDate: string; content: string };

export type DailyReviewMetrics = {
  revenue: string;
  refunds: string;
  promoCost: string;
  customProductCost: string;
  laborCost: string;
  shippingCost: string;
  orderCount: number;
  promoVideoCount: number;
  shootCount: number;
  finishedCount: number;
  publishedCount: number;
  endingInventory: number;
  fanAddedTotal: number;
};

export type ReviewItem = {
  id: string;
  entityType: string;
  entityLabel: string;
  userId: string;
  displayName?: string | null;
  username?: string | null;
  businessDate: string;
  updatedAt: string;
  reviewStatus: ReviewStatus;
  reviewVersion: number;
  reviewReason?: string | null;
  reviewedAt?: string | null;
  payload: Record<string, unknown>;
};

export type ReviewHistoryItem = {
  id: string;
  action: string;
  reason?: string | null;
  actorName: string;
  reviewVersion: number;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  createdAt: string;
};
