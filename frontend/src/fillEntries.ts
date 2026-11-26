import type { Role } from "./api";

export const fillEntries = {
  fans: { path: "/fill/fans", title: "加粉填报", description: "登记公司客服接待账号后填写加粉日报。" },
  orders: { path: "/fill/orders", title: "订单填报", description: "登记公司客服接待账号后录入与查看订单。" }
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

export const csFillPages = {
  home: {path: "/fill", title: "首页", shortTitle: "首页", icon: "home"},
  leads: {path: fillEntries.fans.path, title: "客资登记", shortTitle: "客资", icon: "fans"},
  performance: {path: "/fill/performance", title: "个人业绩", shortTitle: "业绩", icon: "summary"},
  reimbursements: {path: "/fill/reimbursements", title: "垫付报销", shortTitle: "报销", icon: "teamReimbursements"},
  invalid: {path: "/fill/invalid", title: "无效粉库", shortTitle: "无效粉", icon: "customerReview"},
} as const;
export type CsFillPage = keyof typeof csFillPages;
export const csFillPageIds = Object.keys(csFillPages) as CsFillPage[];

export function csFillPageFromPath(pathname: string, allowReimbursements = true): CsFillPage {
  const path = pathname.replace(/\/$/, "");
  if (path === "/fill/after-sales" || path === fillEntries.orders.path) return "leads";
  return csFillPageIds.find(page => csFillPages[page].path === path
    && (allowReimbursements || page !== "reimbursements")) ?? "home";
}
