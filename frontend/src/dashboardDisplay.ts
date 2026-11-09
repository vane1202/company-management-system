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
  return value == null || value === "" ? "—" : `¥ ${value}`;
}

/** 有效金额 = 订单金额（含退款源订单）− 退款金额。两者都是后端已给的人民币金额。 */
export function effectiveOrderAmount(revenue: string | null | undefined, refunds: string | null | undefined): string | null {
  const r = signedCents(revenue), f = signedCents(refunds);
  return r === null || f === null ? null : formatCents(r - f);
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
