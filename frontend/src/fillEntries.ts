import type { Role } from "./api";

export const fillEntries = {
  fans: { path: "/fill/fans", title: "加粉填报", description: "登记公司客服微信号后填写加粉日报。" },
  orders: { path: "/fill/orders", title: "订单填报", description: "登记公司客服微信号后录入与查看订单。" }
} as const;
export type FillEntry = keyof typeof fillEntries;

export function fillEntryFromPath(pathname: string): FillEntry | null {
  const normalized = pathname.replace(/\/$/, "");
  return (Object.keys(fillEntries) as FillEntry[]).find((key) => fillEntries[key].path === normalized) ?? null;
}
export function canUseFillEntry(role: Role, entry: FillEntry): boolean {
  return role === "cs";
}
export function fillLink(origin: string, entry: FillEntry): string {
  return new URL(fillEntries[entry].path, origin).href;
}
export function isLocalOnlyOrigin(origin: string): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
}
