import { addDays, isIsoDate } from "./dates.js";
import { centsToMoney, formatMoney, moneyToCents } from "./money.js";
import { HttpError } from "../types.js";

export type PayrollKind = "commission" | "bonus" | "deduction";
export const PAYROLL_KINDS: PayrollKind[] = ["commission", "bonus", "deduction"];
export const PAYROLL_KIND_LABEL: Record<PayrollKind, string> = { commission: "提成", bonus: "奖金", deduction: "扣款" };

export function parsePayMonth(input: unknown): string {
  const value = String(input ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, "工资月份格式应为 YYYY-MM");
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) throw new HttpError(400, "工资月份超出允许范围");
  return value;
}

export function parsePayrollKind(input: unknown): PayrollKind {
  if (typeof input !== "string" || !PAYROLL_KINDS.includes(input as PayrollKind)) throw new HttpError(400, "项目类型须为提成、奖金或扣款");
  return input as PayrollKind;
}

/** 自然月首日与末日（YYYY-MM-DD）。 */
export function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  if (!isIsoDate(from)) throw new HttpError(400, "工资月份无效");
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

/**
 * 实发 = 底薪 + 提成 + 奖金 − 扣款；全部使用分（BigInt），精确到分，不四舍五入到元。
 * 结果为负数时原样返回并标记，不截断为 0。已作废项目不计入。
 */
export function payslipTotals(base: string, items: { kind: PayrollKind; amount: string; voided?: boolean }[]) {
  const sums: Record<PayrollKind, bigint> = { commission: 0n, bonus: 0n, deduction: 0n };
  for (const item of items) if (!item.voided) sums[item.kind] += moneyToCents(formatMoney(item.amount));
  const net = moneyToCents(formatMoney(base)) + sums.commission + sums.bonus - sums.deduction;
  return {
    base: formatMoney(base),
    commission: centsToMoney(sums.commission),
    bonus: centsToMoney(sums.bonus),
    deduction: centsToMoney(sums.deduction),
    net: centsToMoney(net),
    netNegative: net < 0n
  };
}
