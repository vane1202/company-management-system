import type { FanSummary, PayrollEmployee } from "./api";

/** 有符号金额字符串（如 "-200.00"）→ 分；格式不合法返回 null。只用于展示拆分，不参与核算。 */
export function signedCents(value: string | null | undefined): bigint | null {
  if (value == null) return null;
  const m = /^(-|−)?(\d{1,13})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!m) return null;
  const abs = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -abs : abs;
}
export function formatCents(value: bigint): string {
  const negative = value < 0n, abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
/** 人民币金额加 ¥；缺数据显示 —。 */
export function yuan(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const text = String(value).trim();
  if (!text) return "—";
  const num = Number(text);
  if (!Number.isFinite(num)) return `¥${text}`;
  return `¥${num.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 有效金额 = 订单金额（含退款源订单）− 退款金额。两者都是后端已给的人民币金额。 */
export function effectiveOrderAmount(revenue: string | null | undefined, refunds: string | null | undefined, cancelled='0.00'): string | null {
  const r = signedCents(revenue), f = signedCents(refunds), c=signedCents(cancelled);
  return r === null || f === null || c===null ? null : formatCents(r - f-c);
}

/** 今日未报账号（按小组顺序，去重）。 */
export function missingReporters(teams: FanSummary[] | null | undefined): { userId: string; displayName: string; teamName: string }[] {
  if (!teams) return [];
  const seen = new Set<string>();
  return teams.flatMap(team => team.missing.filter(m => !seen.has(m.userId) && seen.add(m.userId)).map(m => ({ userId: m.userId, displayName: m.displayName, teamName: team.teamName })));
}

export type PayrollStatusSplit = {
  locked: { count: number; net: string };
  draft: { count: number; net: string };
  negatives: { userId: string; displayName: string; net: string; status: "draft" | "locked" }[];
  /** 已锁定 + 草稿 是否等于后端合计（不等时界面不显示拆分，避免两个答案）。 */
  matchesTotal: boolean;
};
/** 只做展示拆分：已锁定 / 草稿 各自的实发合计，负数单列。不改变合计口径（负数仍按后端计入合计）。 */
export function payrollStatusSplit(employees: Pick<PayrollEmployee, "userId" | "displayName" | "net" | "status">[], totalNet: string | null | undefined): PayrollStatusSplit | null {
  let locked = 0n, draft = 0n, lockedCount = 0, draftCount = 0;
  const negatives: PayrollStatusSplit["negatives"] = [];
  for (const e of employees) {
    const n = signedCents(e.net);
    if (n === null) return null;
    if (e.status === "locked") { locked += n; lockedCount++; } else { draft += n; draftCount++; }
    if (n < 0n) negatives.push({ userId: e.userId, displayName: e.displayName, net: formatCents(n), status: e.status });
  }
  const total = signedCents(totalNet);
  return { locked: { count: lockedCount, net: formatCents(locked) }, draft: { count: draftCount, net: formatCents(draft) }, negatives, matchesTotal: total !== null && total === locked + draft };
}

export type FanStateSegment = { key: "replied" | "readNoReply" | "unread" | "invalid" | "unclassified"; label: string; value: number };
/**
 * 四种沟通状态占比（只含当天新增）。段之和小于加粉总数时补一个灰色“未分类”段（如旧版只填总数的记录），
 * 绝不按比例硬凑；段之和大于总数时 overflow 给出多出的数量，由界面如实提示。
 */
export function fanStateSegments(total: number | null | undefined, states: { replied?: number | null; readNoReply?: number | null; unread?: number | null; invalid?: number | null }): { segments: FanStateSegment[]; base: number; overflow: number } | null {
  if (total == null || [states.replied, states.readNoReply, states.unread, states.invalid].some(v => v == null)) return null;
  const segments: FanStateSegment[] = [
    { key: "replied", label: "取得沟通", value: states.replied! },
    { key: "readNoReply", label: "已读不回", value: states.readNoReply! },
    { key: "unread", label: "未读", value: states.unread! },
    { key: "invalid", label: "无效客源", value: states.invalid! }
  ];
  const sum = segments.reduce((n, s) => n + s.value, 0);
  if (sum < total) segments.push({ key: "unclassified", label: "未分类", value: total - sum });
  return { segments, base: Math.max(total, sum), overflow: Math.max(0, sum - total) };
}

/**
 * “月累计（上报）”快照与“区间新增”按日合计相差较大时提示核对。保守阈值：
 * 相差至少 20 人，且至少为两者较大值的 30%。小差异（漏报一两天、口径细节）不提示，避免提示泛滥。
 */
export const MONTH_GAP_MIN_ABS = 20;
export const MONTH_GAP_MIN_RATIO = 0.3;
export function monthGap(reportedMonth: number | null | undefined, summedRange: number | null | undefined): { diff: number; flagged: boolean } | null {
  if (reportedMonth == null || summedRange == null) return null;
  const diff = reportedMonth - summedRange, abs = Math.abs(diff);
  return { diff, flagged: abs >= MONTH_GAP_MIN_ABS && abs >= MONTH_GAP_MIN_RATIO * Math.max(reportedMonth, summedRange) };
}

/** 趋势线可画：至少 2 个有填报的日子。 */
export function sparkReady(values: (number | null)[]): boolean {
  return values.filter(v => v != null).length >= 2;
}
