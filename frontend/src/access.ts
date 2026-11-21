import type { Role } from "./api";

export type Page =
  | "home"
  | "finance"
  | "financeOut"
  | "fans"
  | "summary"
  | "orders"
  | "opsFeedback"
  | "opsAccounts"
  | "ops"
  | "editor"
  | "dashboard"
  | "people"
  | "csAccounts"
  | "salaries"
  | "modules"
  | "assessment"
  | "reportHistory"
  | "customerReview";

export const roleLabel: Record<Role, string> = {
  warehouse: "库房",
  boss: "BOSS",
  admin: "后台管理员",
  finance: "财务",
  assistant: "助理（已停用）",
  ops: "运营",
  editor: "拍剪",
  cs: "客服",
  cs_supervisor: "客服主管"
};

export function navItems(role: Role): { id: Page; label: string }[] {
  if (role === "warehouse") return [{id:"home",label:"库房工作台"}];
  if (role === "finance") return [{id:"home",label:"财务首页"},{id:"finance",label:"收款与结算"},{id:"financeOut",label:"付款与工资"},{id:"salaries",label:"工资核算"}];
  if (role === "admin") return [{ id: "home", label: "系统管理" }, { id: "people", label: "账号与小组" }, { id: "modules", label: "模块管理" }];
  if (role === "boss") return bossDemoNav();
  if (role === "cs_supervisor") return [{ id: "home", label: "工作台首页" }, { id: "summary", label: "本组加粉" }, { id: "orders", label: "本组业绩" }, { id: "assessment", label: "客服考核" }, { id: "customerReview", label: "无效客资复核" }, { id: "csAccounts", label: "客服账号管理" }, { id: "reportHistory", label: "填报历史管理" }];
  const items: { id: Page; label: string }[] = [{ id: "home", label: "首页" }];
  if (role === "cs") items.push({ id: "fans", label: "加粉填报" }, { id: "orders", label: "订单填报" });
  if (role === "ops") return [
    { id: "home", label: "运营工作台" },
    { id: "ops", label: "投放填报" },
    { id: "opsAccounts", label: "广告户管理" },
    ...(import.meta.env.MODE === "demo" ? [{ id: "opsFeedback", label: "反馈与建议" } as const] : [])
  ];
  if (role === "editor") items.push({ id: "editor", label: "拍剪" });
  return items;
}

export function canAccessSalaries(role: Role): boolean {
  return role === "boss" || role === "finance";
}

export function canAccessDashboard(role: Role): boolean {
  return role === "boss";
}

export function canReviewDaily(role: Role): boolean {
  return false;
}

export function bossDemoNav(): { id: Page; label: string }[] {
  return [
    { id: "dashboard", label: "经营总览" },
    { id: "orders", label: "直播间经营" },
    { id: "editor", label: "拍剪数据" }
  ];
}

export function bossLinkedPages(): Page[] {
  return ["finance", "ops", "salaries"];
}

export function pageLabel(role: Role, page: Page): string {
  return navItems(role).find((item) => item.id === page)?.label
    ?? (page === "finance" ? "收款与到账" : page === "ops" ? "投流数据" : page === "salaries" ? "工资汇总" : "");
}
