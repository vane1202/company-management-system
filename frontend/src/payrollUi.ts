import type { PayrollKind } from "./api";
import { yuan } from "./dashboardDisplay";

export const payrollKindLabel: Record<PayrollKind, string> = { commission: "提成", bonus: "奖金", deduction: "扣款" };

/** 以业务日 today（YYYY-MM-DD）为基准，偏移 offset 个月，返回 YYYY-MM。 */
export function shiftMonth(today: string, offset = 0): string {
  const [year, month] = today.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

export function isPayMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** 前端预检：正数、最多两位小数；最终以服务器校验为准。 */
export function payrollAmountError(value: string): string {
  const v = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(v)) return "金额须为正数，最多两位小数";
  if (/^0(\.0{1,2})?$/.test(v)) return "金额须大于 0；扣款请选择“扣款”类型并填写正数";
  if (v.replace(".", "").length > 12) return "金额超出允许范围";
  return "";
}

export function signedLabel(kind: PayrollKind, amount: string): string {
  return `${kind === "deduction" ? "−" : "+"} ${yuan(amount)}`;
}

export const PAYROLL_NOTE_REQUIRED = "备注必填，写明项目或依据";
/** 前端预检：备注去掉首尾空格后不能为空；最终以服务器校验为准。 */
export function payrollNoteError(value: string): string {
  return value.trim() ? "" : PAYROLL_NOTE_REQUIRED;
}
