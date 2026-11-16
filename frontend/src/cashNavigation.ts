import { isIsoDate } from "./dates";

/** Explicit company-wide payment scope; never infer a room from the homepage trend filter. */
export type CashView = { from: string; to: string; metric: "receipts"; scope: "company" };

export function validCashView(value: unknown): value is CashView {
  const item = value as CashView | null;
  return !!item && typeof item.from === "string" && typeof item.to === "string"
    && isIsoDate(item.from) && isIsoDate(item.to) && item.from <= item.to
    && item.metric === "receipts" && item.scope === "company";
}

export function cashViewKey(value?: CashView): string {
  return value ? `${value.from}:${value.to}:${value.metric}:${value.scope}` : "";
}
