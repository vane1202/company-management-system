import type { Role } from "./api";

export type Page =
  | "home"
  | "fans"
  | "summary"
  | "orders"
  | "ops"
  | "editor"
  | "dashboard"
  | "people"
  | "salaries"
  | "review";

export const roleLabel: Record<Role, string> = {
  boss: "Boss",
  admin: "行政",
  assistant: "助理",
  ops: "运营",
  editor: "拍剪",
  cs: "客服",
  cs_supervisor: "客服主管"
};

export function navItems(role: Role): { id: Page; label: string }[] {
  const items: { id: Page; label: string }[] = [{ id: "home", label: "首页" }];
  if (role === "assistant") items.push({ id: "review", label: "审核" });
  if (role === "cs" || role === "cs_supervisor") items.push({ id: "fans", label: "加粉填报" });
  if (role === "cs_supervisor" || role === "boss" || role === "admin") items.push({ id: "summary", label: "加粉汇总" });
  if (role === "cs" || role === "boss" || role === "admin") items.push({ id: "orders", label: "订单" });
  if (role === "ops" || role === "boss" || role === "admin") items.push({ id: "ops", label: "推广" });
  if (role === "editor" || role === "boss" || role === "admin") items.push({ id: "editor", label: "拍剪" });
  if (role === "boss" || role === "admin") {
    items.push({ id: "dashboard", label: "经营估算" }, { id: "people", label: "编制" }, { id: "salaries", label: "工资" });
  }
  return items;
}

export function canAccessSalaries(role: Role): boolean {
  return role === "boss" || role === "admin";
}

export function canAccessDashboard(role: Role): boolean {
  return role === "boss" || role === "admin";
}

export function canReviewDaily(role: Role): boolean {
  return role === "assistant";
}
