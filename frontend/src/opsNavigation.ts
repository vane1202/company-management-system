import { isIsoDate } from "./dates";
export type OpsView = { from: string; to: string };
export function validOpsView(value: unknown): value is OpsView {
  const item = value as OpsView | null;
  return !!item && typeof item.from === "string" && typeof item.to === "string"
    && isIsoDate(item.from) && isIsoDate(item.to) && item.from <= item.to;
}
export const opsViewKey = (value?: OpsView) => value ? `${value.from}:${value.to}` : "";
