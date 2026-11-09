import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { queryOne } from "../db.js";
import { HttpError } from "../types.js";

export const MODULES = { fans: "客服加粉", ops: "运营投放", editor: "拍剪日报", orders: "订单" } as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_SETTING = "business_modules";
export type ModuleConfig = { version: number; modules: Record<ModuleKey, boolean> };
export function parseModuleConfig(value?: string): ModuleConfig {
  const defaults: ModuleConfig = { version: 0, modules: { fans: true, ops: true, editor: true, orders: true } };
  if (!value) return defaults;
  const saved = JSON.parse(value) as ModuleConfig;
  if (!Number.isInteger(saved.version) || saved.version < 0) throw new Error("Invalid module configuration");
  for (const key of Object.keys(MODULES) as ModuleKey[]) {
    if (typeof saved.modules?.[key] !== "boolean") throw new Error("Invalid module configuration");
    defaults.modules[key] = saved.modules[key];
  }
  return { version: saved.version, modules: defaults.modules };
}
export async function loadModuleConfig(db: Pool): Promise<ModuleConfig> {
  const row = await queryOne<{ value: string }>(db, "SELECT value FROM app_settings WHERE key = $1", [MODULE_SETTING]);
  return parseModuleConfig(row?.value);
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
