import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { queryOne } from "../db.js";
import { loadModuleConfig, MODULES, MODULE_SETTING, parseModuleConfig, type ModuleKey } from "../lib/modules.js";
import { HttpError } from "../types.js";
import { isBossOrAdmin } from "../users.js";

export function createModulesRouter(db: Pool): Router {
  const router = Router();
  router.get("/", async (_req, res, next) => {
    try { res.json({ ...await loadModuleConfig(db), labels: MODULES }); }
    catch (error) { next(error); }
  });
  router.put("/", async (req, res, next) => {
    try {
      if (!req.actor || req.actor.role !== "admin") throw new HttpError(403, "仅后台管理员可配置模块");
      const changes = req.body?.modules;
      const version = req.body?.version;
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Number.isInteger(version) || version < 0 || !Object.keys(changes).length) throw new HttpError(400, "模块配置无效");
      for (const [key, value] of Object.entries(changes)) {
        if (!Object.hasOwn(MODULES, key) || typeof value !== "boolean") throw new HttpError(400, "未知模块或开关值无效");
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [MODULE_SETTING, JSON.stringify(parseModuleConfig())]);
        const row = await queryOne<{ value: string }>(client, "SELECT value FROM app_settings WHERE key = $1 FOR UPDATE", [MODULE_SETTING]);
        const before = parseModuleConfig(row!.value);
        if (before.version !== version) throw new HttpError(409, "配置已被其他人更新，请重新加载");
        const after = { version: version + 1, modules: { ...before.modules, ...changes } as Record<ModuleKey, boolean> };
        await client.query("UPDATE app_settings SET value = $2 WHERE key = $1", [MODULE_SETTING, JSON.stringify(after)]);
        await writeAudit(client, { actorId: req.actor.id, action: "modules_update", entityType: "app_settings", entityId: MODULE_SETTING, before, after, ip: req.ip });
        await client.query("COMMIT");
        res.json({ ...after, labels: MODULES });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) { next(error); }
  });
  return router;
}
