import { addDays, daysInMonth, diffDays, startOfMonth } from "./dates.js";
import { centsToMoney, formatMoney, moneyToCents } from "./money.js";

export type SalaryInterval = {
  monthly_amount: string;
  effective_from: string;
  effective_to: string | null;
};

/**
 * 按自然月天数分摊月基本工资。
 * 同一员工重叠区间由数据库排除约束拦截；这里若传入多条重叠记录会分别计入。
 * 整月覆盖时分摊合计等于该月月薪（避免按日向下取整后再累加造成尾差）。
 */
export function allocateSalaries(rows: SalaryInterval[], from: string, to: string): string {
  let cents = 0n;
  for (const row of rows) {
    cents += allocateOneSalary(row, from, to);
  }
  return centsToMoney(cents);
}

function allocateOneSalary(row: SalaryInterval, from: string, to: string): bigint {
  const start = row.effective_from > from ? row.effective_from : from;
  const end = row.effective_to && row.effective_to < to ? row.effective_to : to;
  if (start > end) return 0n;
  const monthly = moneyToCents(formatMoney(row.monthly_amount));
  let total = 0n;
  let cursor = start;
  while (cursor <= end) {
    const monthStart = startOfMonth(cursor);
    const dim = daysInMonth(cursor);
    const monthEnd = addDays(monthStart, dim - 1);
    const sliceEnd = monthEnd < end ? monthEnd : end;
    const coveredDays = diffDays(cursor, sliceEnd) + 1;
    total += (monthly * BigInt(coveredDays)) / BigInt(dim);
    cursor = addDays(sliceEnd, 1);
  }
  return total;
}
