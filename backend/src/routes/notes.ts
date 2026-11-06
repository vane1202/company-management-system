import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { isIsoDate } from "../lib/dates.js";
import { HttpError } from "../types.js";
import { isBossOrAdmin } from "../users.js";

export function createNoteRouter(db: Pool): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const date = String(req.query.date ?? "");
      if (date && !isIsoDate(date)) throw new HttpError(400, "日期无效");
      const actor = req.actor!;
      const rows = await query(
        db,
        `SELECT n.*, u.display_name AS author_name
           FROM notes n
           JOIN users u ON u.id = n.author_id
          WHERE ($1 = '' OR n.target_date = $1::date)
          ORDER BY n.created_at DESC`,
        [date]
      );
      const visible = isBossOrAdmin(actor)
        ? rows
        : rows.filter((row) => row.author_id === actor.id);
      res.json({
        notes: visible.map((row) => ({
          id: row.id,
          authorName: row.author_name,
          targetDate: String(row.target_date).slice(0, 10),
          targetType: row.target_type,
          targetId: row.target_id,
          content: row.content,
          createdAt: row.created_at
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      if (!req.actor || !isBossOrAdmin(req.actor)) {
        throw new HttpError(403, "只有 Boss 或行政可以写批注");
      }
      const targetDate = String(req.body?.targetDate ?? "");
      const content = String(req.body?.content ?? "").trim();
      const targetType = String(req.body?.targetType ?? "day");
      const targetId = req.body?.targetId ? String(req.body.targetId) : null;
      if (!isIsoDate(targetDate)) throw new HttpError(400, "日期无效");
      if (!content) throw new HttpError(400, "批注不能为空");
      const saved = await queryOne(
        db,
        `INSERT INTO notes (author_id, target_date, target_type, target_id, content)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.actor.id, targetDate, targetType, targetId, content]
      );
      await writeAudit(db, {
        actorId: req.actor.id,
        action: "note_create",
        entityType: "note",
        entityId: saved!.id,
        after: { targetDate, targetType },
        ip: req.ip
      });
      res.status(201).json({
        note: {
          id: saved!.id,
          targetDate,
          targetType,
          targetId,
          content
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
