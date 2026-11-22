import { Router } from "express";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { query, withTransaction } from "../db.js";
import { visibleOrder, uuid } from "../lib/commerce.js";
import { businessToday, isIsoDate } from "../lib/dates.js";
import { HttpError } from "../types.js";
import { managedTeamIds } from "../users.js";

export function createSupervisorFollowupsRouter(db: Pool, config: AppConfig) {
  const router = Router();
  router.use((req, _res, next) => req.actor?.role === "cs_supervisor"
    ? next() : next(new HttpError(403, "仅客服主管可管理本组跟进备注")));

  router.get("/", async (req, res, next) => {
    try {
      const scopes = await managedTeamIds(db, req.actor!);
      const records = await query(db, `SELECT f.order_id AS "orderId", f.note,
          COALESCE(f.next_contact_on::text, '') AS "nextContactOn",
          f.version, u.display_name AS "updatedBy", f.updated_at AS "updatedAt"
        FROM supervisor_order_followups f JOIN orders o ON o.id=f.order_id
        JOIN users u ON u.id=f.updated_by
        WHERE EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=o.user_id
          AND m.team_id=ANY($1::uuid[]) AND m.start_date<=o.business_date
          AND (m.end_date IS NULL OR m.end_date>=o.business_date))`, [scopes]);
      res.set("Cache-Control", "private, no-store").json({ records });
    } catch (error) { next(error); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const { note, nextContactOn, version } = req.body ?? {};
      const id = uuid(req.body?.orderId);
      if (typeof note !== "string" || !note.trim() || note.length > 1000) throw new HttpError(400, "请填写 1–1000 字的跟进备注");
      const today = businessToday(new Date(), config.businessTimezone);
      if (nextContactOn !== "" && (typeof nextContactOn !== "string" || !isIsoDate(nextContactOn) || nextContactOn < today)) throw new HttpError(400, "下次联系日期须为今天或之后");
      if (!Number.isSafeInteger(version) || version < 0) throw new HttpError(400, "跟进版本无效");
      const actor = req.actor!;
      const record = await withTransaction(db, async client => {
        await visibleOrder(client, actor, id, true);
        const [previous] = await query<{ version: number }>(client, "SELECT version FROM supervisor_order_followups WHERE order_id=$1", [id]);
        if ((previous?.version ?? 0) !== version) throw new HttpError(409, "跟进已更新，请刷新后再编辑");
        const [saved] = await query(client, `INSERT INTO supervisor_order_followups(order_id,note,next_contact_on,updated_by)
          VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO UPDATE SET note=EXCLUDED.note,
          next_contact_on=EXCLUDED.next_contact_on, updated_by=EXCLUDED.updated_by,
          version=supervisor_order_followups.version+1, updated_at=now()
          RETURNING order_id AS "orderId",note,COALESCE(next_contact_on::text,'') AS "nextContactOn",
          version,updated_at AS "updatedAt"`, [id, note.trim(), nextContactOn || null, actor.id]);
        return { ...saved, updatedBy: actor.displayName };
      });
      res.json({ record });
    } catch (error) { next(error); }
  });
  return router;
}
