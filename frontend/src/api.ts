export type Role = "boss" | "admin" | "finance" | "assistant" | "ops" | "editor" | "cs" | "cs_supervisor";

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  accountKind?: "employee" | "cs_wechat";
  wechatId?: string | null;
  phoneLabel?: string | null;
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
  orderRecord: (id: string) => requestInner<OrderRecord>(`/api/order-records/${encodeURIComponent(id)}`),
  createOrderRecord: (payload: Record<string, unknown>) => requestInner<{id:string}>("/api/order-records", {method:"POST",body:JSON.stringify(payload)}),
  correctOrderRecord: (id: string, payload: Record<string, unknown>) => requestInner<{id:string}>(`/api/order-records/${encodeURIComponent(id)}`, {method:"PATCH",body:JSON.stringify(payload)}),
  orderAction: (id: string, action: string, payload: Record<string, unknown>) => requestInner<{id:string}>(`/api/order-records/${encodeURIComponent(id)}/${action}`, {method:"POST",body:JSON.stringify(payload)}),
  uploadOrderPhoto: (id: string, file: File, itemId: string) => requestInner<{id:string}>(`/api/order-records/${encodeURIComponent(id)}/attachments?${new URLSearchParams({filename:file.name,...(itemId?{itemId}:{})})}`,{method:"POST",headers:{"Content-Type":file.type},body:file}),
  finance: () => requestInner<FinanceData>("/api/finance"),
  financeAction: (action: string, payload: Record<string,unknown>) => requestInner<{id:string}>(`/api/finance/${action}`,{method:"POST",body:JSON.stringify(payload)}),
  csAccounts: (date?: string) => requestInner<{ accounts: CsAccount[] }>(`/api/cs-accounts${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  csTeams: () => requestInner<{ teams: Team[] }>("/api/cs-accounts/teams"),
  updateCsAccount: (id: string, payload: { wechatId: string; phoneLabel: string }) => requestInner<{ needsRegistration: boolean }>(`/api/cs-accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Record<string, unknown>) => requestInner(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  setSupervisorTeams: (id: string, teamIds: string[]) => requestInner(`/api/admin/users/${encodeURIComponent(id)}/scopes`, { method: "PUT", body: JSON.stringify({ teamIds }) }),
  issueCsRegistrationCode: (payload: { teamId?: string; accountId?: string }) => requestInner<{ code: string; expiresAt: string; message: string }>("/api/cs-accounts/registration-codes", { method: "POST", body: JSON.stringify(payload) }),
  setCsAccountStatus: (id: string, isActive: boolean) => requestInner(`/api/cs-accounts/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ isActive }) }),
  registerCsDevice: (payload: { wechatId: string; phoneLabel: string; registrationCode: string }) => requestInner<{ user: User; csrfToken: string; today: string; backfillDays: number }>("/api/auth/cs-device", { method: "POST", body: JSON.stringify(payload) }),
  modules: () => requestInner<{ version: number; modules: Record<string, boolean>; labels: Record<string, string> }>("/api/modules"),
  saveModules: (version: number, modules: Record<string, boolean>) => requestInner<{ version: number; modules: Record<string, boolean>; labels: Record<string, string> }>("/api/modules", { method: "PUT", body: JSON.stringify({ version, modules }) }),
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
  saveFanReport: (payload: Record<string, unknown>) =>
    requestInner<{ report: FanReport; revised: boolean }>("/api/fan-reports", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  fanSummary: (date: string, teamId?: string, accountId?: string) =>
    requestInner<{ date: string; teams: FanSummary[] }>(
      `/api/fan-reports/summary?date=${encodeURIComponent(date)}${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ""}`
    ),
  fanExportUrl: (date: string, accountId?: string) => `/api/fan-reports/export?date=${encodeURIComponent(date)}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ""}`,
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
  orders: (accountId?: string, filters?: { from?: string; to?: string; status?: string }) => requestInner<{ orders: Order[]; totals: { amount: string; refunds: string } }>(`/api/orders?${new URLSearchParams({ ...(accountId ? {userId:accountId} : {}), ...filters })}`),
  settings: () => requestInner<{ settings: Record<string,string> }>("/api/admin/settings"),
  saveSettings: (fan_report_backfill_days: number) => requestInner("/api/admin/settings", { method: "PUT", body: JSON.stringify({ fan_report_backfill_days }) }),
  createOrder: (payload: Record<string, unknown>) =>
    requestInner("/api/orders", { method: "POST", body: JSON.stringify(payload) }),
  dashboard: (preset: string, range?: { from: string; to: string }) =>
    requestInner<{
      period: { from: string; to: string };
      metrics: Metrics;
      dataCounts: { fans: number; ops: number; editor: number };
      disclaimer: string;
      formula: string;
      opsUsd: { spendUsd: string; consultCount: number; clickCount: number; endingBalanceUsd: string | null };
      overallSalary?: { allocated: string; note: string };
      estimateNote?: string;
    }>(`/api/dashboard/summary?preset=${preset}${range ? `&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : ""}`),
  dashboardSeries: (to: string, days = 7) =>
    requestInner<FanSeries>(`/api/dashboard/series?${new URLSearchParams({ to, days: String(days) })}`),
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
  salaries: (userId?: string) => requestInner<{ salaries: Salary[] }>(`/api/salaries${userId?`?userId=${encodeURIComponent(userId)}`:""}`),
  salaryEmployees: () => requestInner<{employees:SalaryEmployee[]}>("/api/salaries/employees"),
  salarySummary: (filters: {from:string;to:string;userId?:string}) => requestInner<SalarySummary>(`/api/salaries/summary?${new URLSearchParams(filters)}`),
  salaryHistory: (id:string) => requestInner<{history:SalaryHistory[]}>(`/api/salaries/${encodeURIComponent(id)}/history`),
  updateSalary: (id:string, payload:Record<string,unknown>) => requestInner(`/api/salaries/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(payload)}),
  payroll: (month: string, userId = "") => requestInner<Payroll>(`/api/salaries/payroll?${new URLSearchParams(userId ? { month, userId } : { month })}`),
  payrollItemHistory: (id: string) => requestInner<{ history: SalaryHistory[] }>(`/api/salaries/payroll/items/${encodeURIComponent(id)}/history`),
  createPayrollItem: (payload: { userId: string; month: string; kind: PayrollKind; amount: string; note: string; requestKey: string }) =>
    requestInner<{ item: PayrollItem; replayed?: boolean }>("/api/salaries/payroll/items", { method: "POST", body: JSON.stringify(payload) }),
  voidPayrollItem: (id: string, payload: { version: number; reason: string }) =>
    requestInner<{ item: PayrollItem }>(`/api/salaries/payroll/items/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify(payload) }),
  correctPayrollItem: (id: string, payload: { version: number; reason: string; kind: PayrollKind; amount: string; note: string; requestKey: string }) =>
    requestInner<{ item: PayrollItem; voided: PayrollItem }>(`/api/salaries/payroll/items/${encodeURIComponent(id)}/correct`, { method: "POST", body: JSON.stringify(payload) }),
  payrollMonthAction: (action: "lock" | "unlock", payload: { userId: string; month: string; version: number; reason?: string }) =>
    requestInner(`/api/salaries/payroll/months/${action}`, { method: "POST", body: JSON.stringify(payload) }),
  createSalary: (payload: Record<string, unknown>) =>
    requestInner("/api/salaries", { method: "POST", body: JSON.stringify(payload) }),
  notes: (date: string) => requestInner<{ notes: Note[] }>(`/api/notes?date=${encodeURIComponent(date)}`),
  createNote: (payload: Record<string, unknown>) =>
    requestInner("/api/notes", { method: "POST", body: JSON.stringify(payload) })
};

export type FanReport = {
  id: string;
  businessDate: string;
  pageName?: string;
  isLegacyUnclassified?: boolean;
  note?: string;
  msToday?: number | null;
  wsToday?: number | null;
  msMonth?: number | null;
  wsMonth?: number | null;
  validToday?: number | null;
  commReplied?: number | null;
  commReadNoReply?: number | null;
  commUnread?: number | null;
  commInvalid?: number | null;
  addedCount: number;
  updatedAt: string;
};

/** 加粉按业务日序列：fanAdded 为 null 表示当天没有任何填报（不是 0）；partial 表示今天尚未结束。 */
export type FanSeries = { from: string; to: string; today: string; days: { date: string; reports: number; fanAdded: number | null; validToday: number | null; partial: boolean }[] };

export type FanSummary = {
  teamId: string;
  teamName: string;
  statsIncomplete?: boolean;
  totalAdded: number;
  validToday?: number;
  commReplied?: number;
  commReadNoReply?: number;
  commUnread?: number;
  commInvalid?: number;
  legacyUnclassifiedAdded?: number;
  expectedCount: number;
  reportedCount: number;
  missingCount: number;
  missing: { userId: string; displayName: string }[];
  details: {
    userId: string;
    displayName: string;
    accountKind?: string;
    wechatId?: string | null;
    addedCount: number | null;
    status: "reported" | "missing";
    updatedAt: string | null;
    pages?: ({ reportId: string } & Record<string, unknown>)[];
  }[];
};

export type OpsReport = {
  id: string;
  businessDate: string;
  platform: string;
  promoVideoCount: number;
  promoCost: string;
  note?: string;
};

export type EditorReport = {
  id: string;
  businessDate: string;
  shootCount: number;
  finishedCount: number;
  publishedCount: number;
  inventorySnapshot: number;
  inventoryAdjusted: boolean;
};

export type Order = {
  id: string;
  workflowEnabled?: boolean;
  userId?: string;
  displayName?: string;
  wechatId?: string | null;
  accountKind?: string;
  businessDate: string;
  orderRef: string;
  customerLabel?: string | null;
  amount: string;
  status: string;
  isCustom: boolean;
  customProductCost: string;
  laborCost: string;
  shippingCost: string;
};

export type Currency = "CNY" | "TWD" | "USD";
export type PaymentRecord = { id:string; payment_date:string; amount:string; currency:Currency; credit_amount:string; purpose:string; channel:string; third_party:boolean; reference:string; note?:string; voided_at:string|null; void_reason?:string; settled_amount:string };
export type ExpenseRecord = {id:string;business_date:string;category:string;label:string;amount_cny:string;voided_at:string|null;void_reason?:string};
export type OrderRecord = {
  legacy:boolean;
  order:{id:string;order_ref:string;customer_label:string;business_date:string;amount:string;status:string;wechat_id?:string;display_name:string;note?:string;custom_product_cost:string;labor_cost:string;shipping_cost:string};
  details?:{personaName:string;operatorName:string;source:string;customerCurrency:Currency;customerDue:string;shippedOn:string|null;version:number};
  items?:{id:string;label:string;material_ref:string;kind:string;price_cny:string;buying_fee_cny:string}[];
  payments?:PaymentRecord[]; expenses?:ExpenseRecord[];
  attachments?:{id:string;item_id:string|null;filename:string;mime_type:string}[];
  paid?:string;balance?:string;expenseTotal?:string;
};
export type FinancePayment=PaymentRecord & {order_id:string;order_ref:string;customer_label:string;persona_name:string;wechat_id:string|null;customer_currency:Currency;pendingAmount:string};
export type SettlementRecord={id:string;reference:string;channel:string;currency:Currency;settled_on:string;fee_amount:string;fee_currency:Currency;fee_percent:string|null;fx_rate:string|null;net_cny:string;note:string;voided_at:string|null;void_reason:string|null;allocations:{paymentId:string;foreignAmount:string;netCny:string}[]};
export type FinanceData={payments:FinancePayment[];settlements:SettlementRecord[];summary:{pending:Record<Currency,string>;directCny:string;settledCny:string;totalCny:string}};

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
  editCount?: number; sentToOpsCount?: number; msToday?: number; wsToday?: number; msMonth?: number; wsMonth?: number; validToday?: number; commReplied?: number; commReadNoReply?: number; commUnread?: number; commInvalid?: number; legacyUnclassifiedAdded?: number; statsIncomplete?: boolean;
};

export type Team = { id: string; name: string; wechatGroupNote?: string | null };
export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  accountKind?: string;
  wechatId?: string | null;
  currentTeam?: { id: string; name: string } | null;
  managedTeamIds?: string[];
};
export type CsAccount = { id: string; wechatId: string; phoneLabel: string | null; isActive: boolean; teamId: string | null; teamName: string | null; createdAt: string };
export type Salary = {
  id: string;
  userId: string;
  displayName: string;
  monthlyAmount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  username?:string;
  role?:Role;
  isActive?:boolean;
  recordVersion:string;
};
export type SalaryEmployee={id:string;displayName:string;username:string;role:Role;isActive:boolean};
export type SalarySummary={period:{from:string;to:string};totalAllocated:string;employeeCount:number;recordCount:number;roles:{role:Role;employeeCount:number;allocated:string}[];employees:{userId:string;displayName:string;username:string;role:Role;isActive:boolean;allocated:string;records:(Salary&{allocated:string})[]}[];note:string};
export type SalaryHistory={id:string;action:string;before:Partial<Salary>|null;after:Partial<Salary>&{reason?:string};createdAt:string;actorName:string};
export type Note = { id: string; authorName: string; targetDate: string; content: string };

export type PayrollKind = "commission" | "bonus" | "deduction";
export type PayrollItem = { id: string; userId: string; month: string; kind: PayrollKind; amount: string; note: string; version: number; createdAt: string; createdByName: string; voided: boolean; voidedAt: string | null; voidReason: string | null; voidedByName: string | null; correctsId: string | null; correctedById: string | null };
export type PayrollTotals = { base: string; commission: string; bonus: string; deduction: string; net: string; netNegative: boolean };
export type PayrollEmployee = PayrollTotals & { userId: string; displayName: string; username: string; role: Role; isActive: boolean; status: "draft" | "locked"; statusVersion: number; lockedAt: string | null; liveBase: string; liveNet: string; changedAfterLock: boolean; baseRecords: { id: string; monthlyAmount: string; effectiveFrom: string; effectiveTo: string | null; allocated: string }[]; items: PayrollItem[] };
export type Payroll = { month: string; period: { from: string; to: string }; totals: PayrollTotals & { employeeCount: number; negativeCount: number; lockedCount: number }; roles: (PayrollTotals & { role: Role; employeeCount: number })[]; employees: PayrollEmployee[]; note: string };
