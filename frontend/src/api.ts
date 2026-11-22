import type { AssessmentFoundation } from "./demo/assessmentFoundation";
import { httpErrorMessage, networkErrorMessage } from "./errors";
import { resolveImageMime } from "./imageMime";
export type Role = "warehouse" | "boss" | "admin" | "finance" | "assistant" | "ops" | "editor" | "cs" | "cs_supervisor";

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  accountKind?: "employee" | "cs_wechat" | "cs_service";
  servicePlatform?:'whatsapp'|'messenger'|'legacy_wechat'|null;
  accountIdentifier?:string|null;
  serviceAccountLabel?:string|null;
  wechatId?: string | null;
  phoneLabel?: string | null;
};

let csrfToken = "";
let unauthorizedHandler: ((message: string) => void) | null = null;

/** Register a handler invoked when an authenticated request fails with HTTP 401. */
export function setUnauthorizedHandler(handler: ((message: string) => void) | null): void {
  unauthorizedHandler = handler;
}

function isAuthEntryPath(path: string): boolean {
  const pathname = path.split("?")[0];
  return (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/me" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/cs-device" ||
    pathname.startsWith("/api/auth/cs-device/")
  );
}

export async function requestInner<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const write = !!options.method && options.method.toUpperCase() !== "GET";
  let response: Response;
  let text: string;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "include"
    });
    text = await response.text();
  } catch (cause) {
    // 断网、连接被拒或读取响应中断：浏览器给的是英文 TypeError，这里换成中文原因。
    const error = new Error(networkErrorMessage(write)) as Error & { code?: string; cause?: unknown };
    error.code = "NETWORK";
    error.cause = cause;
    throw error;
  }
  let data: { error?: string; code?: string; csrfToken?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (response.ok) throw new Error("服务器返回无法解析的响应");
      data = {};
    }
  }
  if (!response.ok) {
    const message = httpErrorMessage(response.status, data.error, write);
    const error = new Error(message) as Error & { code?: string; status?: number };
    error.code = data.code;
    error.status = response.status;
    if (response.status === 401 && unauthorizedHandler && !isAuthEntryPath(path)) {
      unauthorizedHandler(message);
    }
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
  paidPerformance:()=>requestInner<{records:PaidPerformanceRecord[]}>('/api/finance/live-performance'),
  createOrderRecord: (payload: Record<string, unknown>) => requestInner<{id:string}>("/api/order-records", {method:"POST",body:JSON.stringify(payload)}),
  correctOrderRecord: (id: string, payload: Record<string, unknown>) => requestInner<{id:string}>(`/api/order-records/${encodeURIComponent(id)}`, {method:"PATCH",body:JSON.stringify(payload)}),
  orderAction: (id: string, action: string, payload: Record<string, unknown>) => requestInner<{id:string}>(`/api/order-records/${encodeURIComponent(id)}/${action}`, {method:"POST",body:JSON.stringify(payload)}),
  uploadOrderPhoto: async (id: string, file: File, itemId: string) => {
    const mime = await resolveImageMime(file);
    if (!mime) throw new Error("请上传 JPEG、PNG 或 WebP 原图");
    return requestInner<{ id: string }>(
      `/api/order-records/${encodeURIComponent(id)}/attachments?${new URLSearchParams({ filename: file.name, ...(itemId ? { itemId } : {}) })}`,
      { method: "POST", headers: { "Content-Type": mime }, body: file }
    );
  },
  finance: () => requestInner<FinanceData>("/api/finance"),
  payables: () => requestInner<PayablesData>("/api/finance/payables"),
  costAttachments: (expenseId:string) => requestInner<{attachments:{id:string;filename:string;mime_type:string}[]}>(`/api/finance/payables/${encodeURIComponent(expenseId)}/attachments`),
  payableAction: (action:string,payload:Record<string,unknown>) => requestInner(`/api/finance/payables/${action}`,{method:"POST",body:JSON.stringify(payload)}),
  adAccounts: () => requestInner<AdAccountsData>("/api/ad-accounts"),
  adAction: (action:string,payload:Record<string,unknown>) => requestInner(`/api/ad-accounts${action?`/${action}`:""}`,{method:"POST",body:JSON.stringify(payload)}),
  financeAction: (action: string, payload: Record<string,unknown>) => requestInner<{id:string}>(`/api/finance/${action}`,{method:"POST",body:JSON.stringify(payload)}),
  csAccounts: (date?: string) => requestInner<{ accounts: CsAccount[] }>(`/api/cs-accounts${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  csLogins: () => requestInner<{ teams: { id: string; name: string }[]; users: { id: string; username: string; displayName: string; isActive: boolean; mustChangePassword: boolean; teamId: string; teamIds?: string[]; teamName: string }[] }>("/api/cs-logins"),
  createCsLogin: (payload: { username: string; displayName: string; password: string; teamId?: string; teamIds?: string[] }) => requestInner<{ user: { id: string; username: string; displayName: string; mustChangePassword: boolean } }>("/api/cs-logins", { method: "POST", body: JSON.stringify(payload) }),
  updateCsLoginTeams: (id: string, payload: { teamIds: string[]; effectiveDate?: string }) => requestInner<{ ok: boolean }>(`/api/cs-logins/${encodeURIComponent(id)}/teams`, { method: "PATCH", body: JSON.stringify(payload) }),
  assessmentFoundation: () => requestInner<AssessmentFoundation>("/api/assessment/foundation"),
  csTeams: () => requestInner<{ teams: Team[] }>("/api/cs-accounts/teams"),
  createCsAccount:(payload:{platform:'whatsapp'|'messenger';accountIdentifier:string;teamId:string;phoneLabel:string;holderName:string})=>requestInner<{id:string}>('/api/cs-accounts',{method:'POST',body:JSON.stringify(payload)}),
  updateCsAccount: (id: string, payload: { accountIdentifier: string; phoneLabel: string; holderName: string; teamId?: string }) => requestInner<{ needsRegistration: boolean; teamChanged?: boolean }>(`/api/cs-accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Record<string, unknown>) => requestInner(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  resetUserPassword: (id: string, payload: { temporaryPassword?: string; generate?: boolean }) =>
    requestInner<{ ok: boolean; mustChangePassword: boolean; temporaryPassword?: string }>(
      `/api/admin/users/${encodeURIComponent(id)}/reset-password`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  revokeUserSessions: (id: string) =>
    requestInner<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  setSupervisorTeams: (id: string, teamIds: string[]) => requestInner(`/api/admin/users/${encodeURIComponent(id)}/scopes`, { method: "PUT", body: JSON.stringify({ teamIds }) }),
  issueCsRegistrationCode: (payload: { teamId?: string; accountId?: string }) => requestInner<{ code: string; expiresAt: string; message: string }>("/api/cs-accounts/registration-codes", { method: "POST", body: JSON.stringify(payload) }),
  setCsAccountStatus: (id: string, isActive: boolean) => requestInner(`/api/cs-accounts/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ isActive }) }),
  csRegistrationOptions:(registrationCode:string)=>requestInner<{accounts:{id:string;platform:'whatsapp'|'messenger'|'legacy_wechat';accountIdentifier:string;label:string;phoneLabel:string|null;holderName:string|null}[]}>('/api/auth/cs-device/options',{method:'POST',body:JSON.stringify({registrationCode})}),
  registerCsDevice: (payload: { accountId: string; phoneLabel: string; registrationCode: string }) => requestInner<{ user: User; csrfToken: string; today: string; backfillDays: number }>("/api/auth/cs-device", { method: "POST", body: JSON.stringify(payload) }),
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
  orders: (accountId?: string, filters?: { from?: string; to?: string; status?: string }) => requestInner<{ orders: Order[]; totals: { amount: string; refunds: string; cancelled?:string; turnover?:string; turnoverCount?:number } }>(`/api/orders?${new URLSearchParams({ ...(accountId ? {userId:accountId} : {}), ...filters })}`),
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
      opsUsd: { spendUsd: string; consultCount: number; clickCount: number; endingBalanceUsd: string | null; balanceMethod?:string };
      overallSalary?: { allocated: string; note: string };
      estimateNote?: string;
    }>(`/api/dashboard/summary?preset=${preset}${range ? `&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : ""}`),
  dashboardSeries: (to: string, days = 7) =>
    requestInner<FanSeries>(`/api/dashboard/series?${new URLSearchParams({ to, days: String(days) })}`),
  liveBusiness: (preset:string,range:{from:string;to:string}|undefined,filters:LiveBusinessFilters) => requestInner<LiveBusinessData>(`/api/dashboard/live-business?${new URLSearchParams({preset,...range,...filters})}`),
  teams: () => requestInner<{ teams: Team[] }>("/api/admin/teams"),
  createTeam: (payload: Record<string, unknown>) =>
    requestInner("/api/admin/teams", { method: "POST", body: JSON.stringify(payload) }),
  updateTeam: (id: string, payload: { name: string }) =>
    requestInner("/api/admin/teams/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(payload) }),
  deleteTeam: (id: string) =>
    requestInner("/api/admin/teams/" + encodeURIComponent(id), { method: "DELETE" }),
  users: () => requestInner<{ users: AdminUser[] }>("/api/admin/users"),
  createUser: (payload: Record<string, unknown>) =>
    requestInner("/api/admin/users", { method: "POST", body: JSON.stringify(payload) }),
  transferUser: (id: string, payload: Record<string, unknown>) =>
    requestInner(`/api/admin/users/${encodeURIComponent(id)}/transfer`, { method: "POST", body: JSON.stringify(payload) }),
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
  cancelled?:boolean;
  bookingAmount?:string;
  id: string;
  workflowEnabled?: boolean;
  dealChannel?:"live"|"private";projectLine?:string;personaCode?:string;personaName?:string;liveRoomCode?:string;hostName?:string;customerCode?:string;operatorName?:string;
  userId?: string;
  displayName?: string;
  wechatId?: string | null;
  accountKind?: string;
  teamId?: string | null;
  teamName?: string | null;
  businessDate: string;
  orderRef: string;
  customerLabel?: string | null;
  amount: string;
  status: string;
  isCustom: boolean;
  customProductCost: string;
  laborCost: string;
  shippingCost: string;
  materialCost?: string | null;
  materialCostCny?: string | null;
  materialLotNo?: string | null;
  hasSourcingNoSettle?: boolean;
};

export type Currency = "CNY" | "TWD" | "USD" | "SGD" | "HKD";
export type LiveBusinessFilters={room:string;host:string;persona:string;operator:string};
export type LiveBusinessTotals={performanceCny:string;newSalesCny:string;grossSalesCny:string;cancelledSalesCny:string;grossOrderCount:number;cancelledOrderCount:number;additionalCny:string;excludedAdditionalCny:string;expenseCny:string;supplierPaidCny:string;companyReceivedCny:string;excludedSourceCny:string;newOrderCount:number;expenseCount:number;customerReceipts:Record<Currency,string>};
export type LiveRoomStaffLine={value:string|null;status:'ok'|'pending_finance'|'unsupported_scope';records:{id:string;date:string;amount_cny:string;session_label:string;note:string}[]};
export type LivePaymentStatus='unpaid'|'partial'|'settled'|'unknown';
export type LivePaymentProgress=Record<LivePaymentStatus,number>&{total:number;followupCount:number};
export type LiveOperationOrder={id:string;reference:string;customerLabel:string;customerCode:string;operatorName:string;serviceAccount:string;roomKey:string;roomCode:string;hostName:string;personaName:string;bookingDate:string;currency:Currency|null;due:string|null;paid:string|null;balance:string|null;status:LivePaymentStatus;bookedInPeriod:boolean};
export type LiveRoomOperations={asOf:string;summary:LivePaymentProgress;rooms:Record<string,LivePaymentProgress>;orders:LiveOperationOrder[];cohort:string;followupScope:string;basis:string};
export type LiveRoomMaterialSources={orderCardCny:string;expenseFallbackCny:string;excludedCancelledCny:string;label:string};
export type LiveRoomProfit={materialCostCny:string;materialCostSources?:LiveRoomMaterialSources;staff:{hostCommission:LiveRoomStaffLine;assistantCommission:LiveRoomStaffLine;actorSessionFee:LiveRoomStaffLine;totalCny:string|null;status:'ok'|'pending_finance'|'unsupported_scope'};liveRoomProfitCny:string|null;status:'ok'|'pending_finance'|'unsupported_scope';source:string};
export type LiveBusinessOrder={id:string;status:string;cancelled?:boolean;order_ref:string;customer_label:string|null;persona_code:string;persona_name:string;live_room_code:string;host_name:string;customer_code:string;operator_name:string;wechat_id:string};
export type LiveBusinessEvent={id:string;order_id:string;kind:'sale'|'charge'|'expense'|'receipt'|'company'|'supplier';date:string;amount:string;currency:Currency;category:string;label:string;order:LiveBusinessOrder};
export type LiveBusinessData={operations?:LiveRoomOperations;period:{from:string;to:string};selected:LiveBusinessFilters;totals:LiveBusinessTotals;paidPerformance:{amountCny:string|null;recordCount:number;scope:'room_host';records:{id:string;date:string;live_room_code:string;host_name:string;amount_cny:string;note:string}[]};afterSales:{receipts:Record<Currency,string>;recordCount:number;unclassifiedReceiptCount:number;records:{id:string;date:string;amount:string;currency:Currency;order_id:string;order_ref:string;customer_label:string;live_room_code:string;host_name:string;operator_name:string;charge_id:string;label:string;quoted_cny:string;cost_cny:string;costs_completed_at:string|null;margin_cny:string|null;charge_voided_at:string|null}[]};rooms:{key:string;roomCode:string;hosts:string[];personas:string[];totals:LiveBusinessTotals;profit?:LiveRoomProfit}[];events:LiveBusinessEvent[];options:{room:string;host:string;persona:string;persona_name:string;operator:string}[];legacyCost:{count:number;amountCny:string};ads:{scope:'company';spendUsd:string;records:{id:string;date:string;persona:string;account:string;amount:string}[];unknownCount:number};profitMethod?:string};
export type PaidPerformanceRecord={id:string;business_date:string;live_room_code:string;host_name:string;amount_cny:string;note:string;created_by_name:string;voided_at:string|null;void_reason:string|null};
export type PaymentRecord = { after_sale_charge_id?:string|null;id:string; payment_date:string; amount:string; currency:Currency; credit_amount:string; received_cny?:string|null; purpose:string; channel:string; third_party:boolean; reference:string; note?:string; voided_at:string|null; void_reason?:string; settled_amount:string };
export type ExpenseRecord = {after_sale_charge_id?:string|null;id:string;business_date:string;category:string;label:string;amount_cny:string;counterparty?:string;item_id?:string;note?:string;voided_at:string|null;void_reason?:string};
export type ChargeRecord = {cost_cny?:string;costs_completed_at?:string|null;margin_cny?:string|null;id:string;business_date:string;label:string;amount_cny:string;customer_amount:string;note:string;voided_at:string|null;void_reason?:string};
export type CompanyExpense = ExpenseRecord & {order_id:string;order_ref:string;customer_label:string;persona_name:string;persona_code:string;live_room_code:string;host_name:string;customer_code:string;operator_name:string;wechat_id:string;material_ref:string;item_label:string;item_sourcing_no_settle?:boolean;paid_cny:string;pending_cny:string|null;paymentState:string};
export type SupplierPayment = {id:string;expense_id:string;paid_on:string;payee:string;account:string;reference:string;amount_cny:string;note:string;voided_at:string|null;void_reason?:string};
export type PayablesData = {expenses:CompanyExpense[];payments:SupplierPayment[];summary:{costCny:string;paidCny:string;pendingCny:string;unknownCount:number}};
export type AdAccount = {code:string;name:string;opened_on:string;opening_usd:string;topped_usd:string;spent_usd:string;balance_usd:string};
export type AdTopup = {id:string;account_ref:string;paid_on:string;credited_usd:string;paid_cny:string;payment_account:string;reference:string;note:string;voided_at:string|null;void_reason?:string};
export type AdAccountsData = {accounts:AdAccount[];topups:AdTopup[];summary:{paidCny:string;creditedUsd:string;spentUsd:string;balanceUsd:string}};
export type OrderRecord = {
  legacy:boolean;
  order:{id:string;order_ref:string;customer_label:string;business_date:string;amount:string;status:string;cancelled?:boolean;wechat_id?:string;display_name:string;note?:string;custom_product_cost:string;labor_cost:string;shipping_cost:string;material_cost_cny?:string|null;material_lot_no?:string|null};
  cancellations?:{id:string;booked_on:string;base_amount_cny:string;reason:string;created_at:string;created_by_name:string|null;voided_at:string|null;void_reason:string|null;voided_by_name:string|null}[];
  details?:{dealChannel?:"live"|"private";projectLine?:string;personaName:string;personaCode?:string;liveRoomCode?:string;hostName?:string;customerCode?:string;operatorName:string;source:string;customerCurrency:Currency;customerDue:string;baseCustomerDue?:string;shippedOn:string|null;version:number};
  items?:{id:string;label:string;material_ref:string;kind:string;price_cny:string;buying_fee_cny:string;sourcing_no_settle?:boolean}[];
  payments?:PaymentRecord[]; expenses?:ExpenseRecord[]; charges?:ChargeRecord[];
  attachments?:{id:string;item_id:string|null;filename:string;mime_type:string}[];
  paid?:string;balance?:string;expenseTotal?:string;
};
export type FinancePayment=PaymentRecord & {order_id:string;order_ref:string;customer_label:string;persona_name:string;persona_code?:string;live_room_code?:string;host_name?:string;customer_code?:string;operator_name?:string;wechat_id:string|null;customer_currency:Currency;pendingAmount:string};
export type SettlementRecord={id:string;reference:string;channel:string;currency:Currency;settled_on:string;fee_amount:string;fee_currency:Currency;fee_percent:string|null;fx_rate:string|null;net_cny:string;note:string;voided_at:string|null;void_reason:string|null;allocations:{paymentId:string;foreignAmount:string;netCny:string}[]};
export type FinanceData={payments:FinancePayment[];settlements:SettlementRecord[];summary:{pending:Record<Currency,string>;directCny:string;settledCny:string;totalCny:string}};

export type Metrics = {
  revenue: string;
  baseOrderRevenue?: string;
  additionalChargesRevenue?: string;
  refunds: string;
  promoCost: string;
  salaryAllocated: string;
  customProductCost: string;
  laborCost: string;
  shippingCost: string;
  estimate: string;
  customerReceipts?: Record<Currency, string>;
  companyReceivedCny?: string;
  supplierPaidCny?: string;
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
  currentTeams?: { id: string; name: string }[];
  managedTeamIds?: string[];
};
export type CsAccount = { id: string; wechatId: string; platform?:'whatsapp'|'messenger'|'legacy_wechat';accountIdentifier?:string;phoneLabel: string | null; holderName?: string | null; isActive: boolean; teamId: string | null; teamName: string | null; createdAt: string };
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
