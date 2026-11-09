import type { Role } from "./api";

export type Page =
  | "home"
  | "finance"
  | "fans"
  | "summary"
  | "orders"
  | "ops"
  | "editor"
  | "dashboard"
  | "people"
  | "csAccounts"
  | "salaries"
  | "modules";

export const roleLabel: Record<Role, string> = {
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
  if (role === "finance") return [{id:"home",label:"财务工作台"},{id:"salaries",label:"工资核算"}];
  if (role === "admin") return [{ id: "home", label: "系统管理" }, { id: "people", label: "账号与小组" }, { id: "csAccounts", label: "客服微信号" }, { id: "modules", label: "模块管理" }];
  if (role === "boss") return [{ id: "home", label: "管理总览" }, { id: "summary", label: "加粉汇总" }, { id: "orders", label: "消费汇总" }, { id: "ops", label: "推广汇总" }, { id: "editor", label: "拍剪汇总" }, {id:"finance",label:"收款与结算"}, { id: "dashboard", label: "经营估算" }, { id: "salaries", label: "工资汇总" }];
  if (role === "cs_supervisor") return [{ id: "home", label: "本组工作台" }, { id: "summary", label: "本组加粉" }, { id: "orders", label: "本组消费" }, { id: "csAccounts", label: "本组客服微信" }];
  const items: { id: Page; label: string }[] = [{ id: "home", label: "首页" }];
  if (role === "cs") items.push({ id: "fans", label: "加粉填报" }, { id: "orders", label: "订单填报" });
  if (role === "ops") items.push({ id: "ops", label: "推广" });
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
