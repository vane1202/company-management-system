export const invalidReasonLabels = {
  no_chinese: "语言不通（未能取得正常沟通）",
  misclick: "误点咨询/不感兴趣",
  obscene: "色粉",
  custom: "其他（需主管复核）"
} as const;
export type InvalidReason = keyof typeof invalidReasonLabels;
export type ContactStatus = "replied" | "read_no_reply" | "unread" | "invalid";
export type EmployeeStatus = "active" | "left";
export type EmployeeRecord = { id: string; code: string; name: string; status: EmployeeStatus; teamId: string };
export type TenureRecord = { id: string; accountId: string; employeeId: string; startDate: string; endDate: string | null };
export type OrderLink = "linked" | "unlinked";
export type AssessmentLead = { id: string; accountId: string; businessDate: string; employeeId: string; pageName: string; sourceAdAccountId?: string; channel: "ms" | "ws"; contact: ContactStatus; qualified: boolean; invalidReason: InvalidReason | ""; customerLabel?: string; operatorName?: string; needSummary?: string; pendingReview?: boolean; attemptContact?: boolean; dealt?: boolean };
export type AssessmentAttendance = { id: string; accountId: string; businessDate: string; employeeId: string; roomCode: string; roomName: string; enteredCount: number; orderedCustomerIds: string[]; orderLink: OrderLink; source: string };
export type OrderAttribution = { id: string; accountId: string; businessDate: string; customerLabel: string; employeeId: string | null; countsAsOrder: boolean };
export type InvalidFact = { businessDate: string; pageName: string; sourceAdAccountId?: string; received: number; no_chinese: number; misclick: number; obscene: number; unspecified: number };
export type SourceAdSummary = { adAccountId: string; received: number; replied: number; qualified: number; no_chinese: number; misclick: number; obscene: number; unspecified: number };
export function sourceAdLabel(id?: string): string { const value = (id || "").trim(); return value || "来源待补"; }
export type AssessmentFoundation = {
  version: "assessment-foundation/v1";
  demo: boolean;
  today: string;
  view: "directory" | "capture" | "review" | "invalid";
  employees?: EmployeeRecord[];
  teams?: {id:string;name:string}[];
  tenures?: TenureRecord[];
  leads?: AssessmentLead[];
  attendance?: AssessmentAttendance[];
  orders?: OrderAttribution[];
  invalid?: InvalidFact[];
  sourceAds?: SourceAdSummary[];
  holderCheck?: { accountId: string; matched: boolean }[];
  privateSales?: { id: string; businessDate: string; operatorName: string; customerLabel: string; amount: string; cancelled: boolean }[];
  note: string;
};

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
export function shiftDate(value: string, days: number): string {
  return new Date(Date.parse(value + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
export function tenuresOn(tenures: TenureRecord[], accountId: string, date: string): TenureRecord[] {
  if (!isIsoDate(date)) return [];
  return tenures.filter((row) => row.accountId === accountId && row.startDate <= date && (row.endDate === null || row.endDate >= date));
}
export function holderOn(tenures: TenureRecord[], accountId: string, date: string): TenureRecord | null {
  const rows = tenuresOn(tenures, accountId, date);
  return rows.length === 1 ? rows[0] : null;
}

export type HandoverInput = { accountId: string; toEmployeeId: string; date: string; today: string; tenureId: string };
export function applyHandover(tenures: TenureRecord[], input: HandoverInput): { tenures: TenureRecord[] } | { error: string } {
  if (!isIsoDate(input.date) || !isIsoDate(input.today) || input.date > input.today) return { error: "交接日无效或晚于今天" };
  const open = tenures.filter((row) => row.accountId === input.accountId && row.endDate === null);
  if (open.length !== 1) return { error: "该账号没有唯一的当前使用人，不能交接" };
  const current = open[0];
  if (current.employeeId === input.toEmployeeId) return { error: "新使用人与当前使用人相同" };
  if (input.date <= current.startDate) return { error: "交接日必须晚于当前使用开始日" };
  const previousEnd = shiftDate(input.date, -1);
  const clash = tenures.some((row) => row.id !== current.id && row.accountId === input.accountId && row.startDate <= input.date && (row.endDate === null || row.endDate >= input.date));
  if (clash) return { error: "交接日已有其他使用记录" };
  const next = tenures.map((row) => row.id === current.id ? { ...row, endDate: previousEnd } : row);
  next.push({ id: input.tenureId, accountId: input.accountId, employeeId: input.toEmployeeId, startDate: input.date, endDate: null });
  return { tenures: next };
}

export function formatShare(part: number, whole: number): string | null {
  if (!Number.isInteger(part) || !Number.isInteger(whole) || part < 0 || whole <= 0 || part > whole) return null;
  return (Math.round((part * 1000) / whole) / 10).toFixed(1);
}
export function shareLabel(part: number, whole: number): string | null {
  const rate = formatShare(part, whole);
  if (rate === null) return null;
  return (rate.endsWith(".0") ? rate.slice(0, -2) : rate) + "% · " + part + "/" + whole + "人";
}

export type CohortLead = { employeeId: string; businessDate: string; contact: ContactStatus; qualified: boolean };
export type CohortFact = { employeeId: string; businessDate: string; received: number; replied: number; qualified: number; invalid: number; readNoReply: number; unread: number; openingRate: string | null };
export function cohortFacts(leads: CohortLead[]): CohortFact[] {
  const grouped = new Map<string, CohortFact>();
  for (const lead of leads) {
    const key = lead.employeeId + "|" + lead.businessDate;
    const row = grouped.get(key) ?? { employeeId: lead.employeeId, businessDate: lead.businessDate, received: 0, replied: 0, qualified: 0, invalid: 0, readNoReply: 0, unread: 0, openingRate: null };
    row.received += 1;
    if (lead.contact === "replied") row.replied += 1;
    if (lead.contact === "replied" && lead.qualified) row.qualified += 1;
    if (lead.contact === "invalid") row.invalid += 1;
    if (lead.contact === "read_no_reply") row.readNoReply += 1;
    if (lead.contact === "unread") row.unread += 1;
    grouped.set(key, row);
  }
  return [...grouped.values()].map((row) => ({ ...row, openingRate: formatShare(row.qualified, row.replied) })).sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.employeeId.localeCompare(b.employeeId));
}
export function attendanceShare(enteredCount: number, orderedCount: number, orderLink: OrderLink): string | null {
  return orderLink === "linked" ? formatShare(orderedCount, enteredCount) : null;
}
export function orderPeople(rows: OrderAttribution[]): { unassigned: number; rows: { employeeId: string; businessDate: string; customers: number }[] } {
  const grouped = new Map<string, { employeeId: string; businessDate: string; customers: Set<string> }>();
  let unassigned = 0;
  for (const row of rows) {
    if (!row.countsAsOrder) continue;
    if (!row.employeeId) { unassigned += 1; continue; }
    const key = row.employeeId + "|" + row.businessDate;
    const item = grouped.get(key) ?? { employeeId: row.employeeId, businessDate: row.businessDate, customers: new Set<string>() };
    item.customers.add(row.customerLabel.trim().toLowerCase() || row.id);
    grouped.set(key, item);
  }
  return { unassigned, rows: [...grouped.values()].map((item) => ({ employeeId: item.employeeId, businessDate: item.businessDate, customers: item.customers.size })).sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.employeeId.localeCompare(b.employeeId)) };
}

export function contactFromNote(summary: string): { contact: ContactStatus | ""; invalidReason: InvalidReason | "" } {
  const compact = summary.replace(/\s/g, "");
  if (/色情|淫秽|黄色/.test(compact)) return { contact: "invalid", invalidReason: "obscene" };
  if (/不会中文|不懂中文|不说中文|没有中文|无中文/.test(compact)) return { contact: "invalid", invalidReason: "no_chinese" };
  if (/误点|错按|按错|点错/.test(compact)) return { contact: "invalid", invalidReason: "misclick" };
  if (/已读不回|不回复|未回复/.test(compact)) return { contact: "read_no_reply", invalidReason: "" };
  if (compact.includes("未读")) return { contact: "unread", invalidReason: "" };
  if (summary.trim()) return { contact: "replied", invalidReason: "" };
  return { contact: "", invalidReason: "" };
}

export function reasonGap(total: string, parts: string[]): { status: "empty" | "missing" | "invalid" | "over" | "ok"; unspecified: number | null } {
  if (total.trim() === "") return { status: "empty", unspecified: null };
  if (!/^\d{1,7}$/.test(total)) return { status: "invalid", unspecified: null };
  if (parts.every((part) => part.trim() === "")) return { status: "missing", unspecified: null };
  if (parts.some((part) => part.trim() !== "" && !/^\d{1,7}$/.test(part))) return { status: "invalid", unspecified: null };
  const sum = parts.reduce((count, part) => count + Number(part || 0), 0);
  const whole = Number(total);
  if (sum > whole) return { status: "over", unspecified: null };
  return { status: "ok", unspecified: whole - sum };
}
