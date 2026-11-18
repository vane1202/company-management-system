import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { queryOne } from "../db.js";
import { HttpError } from "../types.js";

export const MODULES = { fans: "客服加粉", ops: "运营投放", editor: "拍剪日报", orders: "订单", warehouse: "库房结账" } as const;
export type ModuleKey = keyof typeof MODULES;
/** Keys added after the first release: a stored configuration without them keeps them enabled instead of failing closed. */
const ADDED_LATER: ModuleKey[] = ["warehouse"];
/** What a switch controls, shown to the administrator next to it. Keep in step with the guards in app.ts and access.ts. */
export const MODULE_DETAILS: Record<ModuleKey, { summary: string; roles: string[] }> = {
  fans: { summary: "客服每日加粉日报和线索明细的新增、修改。客服主管只读，不受影响。", roles: ["客服"] },
  ops: { summary: "运营推广日报，以及广告账户的新增、修改（运营和财务都会受影响）。", roles: ["运营", "财务"] },
  editor: { summary: "拍剪日报的新增、修改。", roles: ["拍剪"] },
  orders: { summary: "订单与订单明细的新增、修改，含跑单、取消等登记。不含库房结账，财务收付款不受影响。", roles: ["客服"] },
  warehouse: { summary: "库房提交、重新提交对外结账单。已提交的账单仍可由财务审核、付款和结清，避免欠款无法支付。", roles: ["库房"] }
};
export const MODULE_SETTING = "business_modules";
export type ModuleConfig = { version: number; modules: Record<ModuleKey, boolean> };
export function parseModuleConfig(value?: string): ModuleConfig {
  const defaults: ModuleConfig = { version: 0, modules: { fans: true, ops: true, editor: true, orders: true, warehouse: true } };
  if (!value) return defaults;
  const saved = JSON.parse(value) as ModuleConfig;
  if (!Number.isInteger(saved.version) || saved.version < 0) throw new Error("Invalid module configuration");
  for (const key of Object.keys(MODULES) as ModuleKey[]) {
    if (saved.modules?.[key] === undefined && ADDED_LATER.includes(key)) continue;
    if (typeof saved.modules?.[key] !== "boolean") throw new Error("Invalid module configuration");
    defaults.modules[key] = saved.modules[key];
  }
  return { version: saved.version, modules: defaults.modules };
}
export async function loadModuleConfig(db: Pool): Promise<ModuleConfig> {
  const row = await queryOne<{ value: string }>(db, "SELECT value FROM app_settings WHERE key = $1", [MODULE_SETTING]);
  return parseModuleConfig(row?.value);
}
/** Latest configuration change, for the administrator's page. Never fails the request: it is only informational. */
export async function loadLastModuleChange(db: Pool): Promise<{ at: string; by: string | null } | null> {
  try {
    const row = await queryOne<{ created_at: Date | string; display_name: string | null }>(db,
      `SELECT a.created_at, u.display_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.action = 'modules_update' AND a.entity_type = 'app_settings' AND a.entity_id = $1
       ORDER BY a.created_at DESC LIMIT 1`, [MODULE_SETTING]);
    return row ? { at: new Date(row.created_at).toISOString(), by: row.display_name } : null;
  } catch { return null; }
}
export function guardModuleWrites(db: Pool, key: ModuleKey) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
      const config = await loadModuleConfig(db);
      if (!config.modules[key]) throw new HttpError(403, "该模块已停用，历史数据保留，可联系管理员重新启用", "MODULE_DISABLED");
      next();
    } catch (error) { next(error); }
  };
}
