import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { businessToday, isIsoDate, toDateOnly } from "../lib/dates.js";
import { parseCount, parseMoney } from "../lib/money.js";
import { recordSubmission, reviewPublicFields } from "../lib/review.js";
import { HttpError } from "../types.js";
import { isBossOrAdmin, type Actor } from "../users.js";
import type { AppConfig } from "../config.js";

export function createOpsRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const userId = resolveListUserId(actor, req.query.userId, "无权查看他人的运营记录");
      const rows = await query(
        db,
        `SELECT * FROM ops_reports
          WHERE ($1::uuid IS NULL OR user_id = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
         ORDER BY business_date DESC, platform`,
        [userId, emptyDate(req.query.from), emptyDate(req.query.to)]
      );
      res.json({ reports: rows.map(serializeOps) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role !== "ops" && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只有运营或管理员可以填写推广数据");
      }
      const targetId = String(req.body?.userId ?? actor.id);
      if (targetId !== actor.id && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只能填写本人的运营数据");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const businessDate = String(req.body?.businessDate ?? today);
      if (!isIsoDate(businessDate) || businessDate > today) throw new HttpError(400, "业务日无效");
      const platform = String(req.body?.platform ?? "").trim();
      if (platform.length > 64) throw new HttpError(400, "推广平台过长");
      const promoVideoCount = parseCount(req.body?.promoVideoCount, "推广视频数");
      const promoCost = parseMoney(req.body?.promoCost, "推广费用");
      const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const existing = await queryOne<Record<string, unknown>>(
          client,
          `SELECT * FROM ops_reports
            WHERE user_id = $1 AND business_date = $2 AND platform = $3
            FOR UPDATE`,
          [targetId, businessDate, platform]
        );
        const unchanged = Boolean(
          existing &&
            Number(existing.promo_video_count) === promoVideoCount &&
            Number(existing.promo_cost) === Number(promoCost) &&
            (existing.note ?? null) === note
        );
        if (existing && unchanged) {
          await client.query("COMMIT");
          res.json({ report: serializeOps(existing) });
          return;
        }
        const saved = existing
          ? await queryOne(
              client,
              `UPDATE ops_reports
                  SET promo_video_count = $2, promo_cost = $3, note = $4, updated_at = now()
                WHERE id = $1
                RETURNING *`,
              [existing.id, promoVideoCount, promoCost, note]
            )
          : await queryOne(
              client,
              `INSERT INTO ops_reports (user_id, business_date, platform, promo_video_count, promo_cost, note, last_submitted_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *`,
              [targetId, businessDate, platform, promoVideoCount, promoCost, note, actor.id]
            );
        await recordSubmission(client, {
          table: "ops_reports",
          entityType: "ops_report",
          id: String(saved!.id),
          actorId: actor.id,
          changed: true,
          isNew: !existing,
          ip: req.ip
        });
        await writeAudit(client, {
          actorId: actor.id,
          action: "ops_report_upsert",
          entityType: "ops_report",
          entityId: String(saved!.id),
          after: { businessDate, platform, promoVideoCount, promoCost },
          ip: req.ip
        });
        const fresh = await queryOne(client, "SELECT * FROM ops_reports WHERE id = $1", [saved!.id]);
        await client.query("COMMIT");
        res.json({ report: serializeOps(fresh) });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createEditorRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const userId = resolveListUserId(actor, req.query.userId, "无权查看他人的拍剪记录");
      const rows = await query(
        db,
        `SELECT * FROM editor_reports
          WHERE ($1::uuid IS NULL OR user_id = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
         ORDER BY business_date DESC`,
        [userId, emptyDate(req.query.from), emptyDate(req.query.to)]
      );
      res.json({ reports: rows.map(serializeEditor) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const targetId = req.query.userId ? String(req.query.userId) : "";
      if (targetId) assertSelfOrBoss(actor, targetId, "无权查看他人拍剪汇总");
      if (!targetId && !isBossOrAdmin(actor) && actor.role !== "editor") {
        throw new HttpError(403, "无权查看拍剪汇总");
      }
      const userFilter = targetId || (actor.role === "editor" ? actor.id : "");
      const from = emptyDate(req.query.from);
      const to = emptyDate(req.query.to);
      const totals = await queryOne<{ shoot: string; finished: string; published: string }>(
        db,
        `SELECT COALESCE(SUM(shoot_count),0)::text AS shoot,
                COALESCE(SUM(finished_count),0)::text AS finished,
                COALESCE(SUM(published_count),0)::text AS published
           FROM editor_reports
          WHERE ($1 = '' OR user_id::text = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)`,
        [userFilter, from, to]
      );
      const latest = await query<{ user_id: string; inventory_snapshot: number; business_date: string }>(
        db,
        `SELECT DISTINCT ON (user_id) user_id, inventory_snapshot, business_date::text
           FROM editor_reports
          WHERE ($1 = '' OR user_id::text = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
          ORDER BY user_id, business_date DESC`,
        [userFilter, from, to]
      );
      const endingInventory = latest.reduce((sum, row) => sum + Number(row.inventory_snapshot), 0);
      res.json({
        shootCount: Number(totals?.shoot ?? 0),
        finishedCount: Number(totals?.finished ?? 0),
        publishedCount: Number(totals?.published ?? 0),
        endingInventory,
        inventoryMethod: "ending_snapshots_only",
        note: "囤量为区间内每人最后一条存量快照之和，不是快照相加后的产量。"
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role !== "editor" && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只有拍剪或管理员可以填写拍剪数据");
      }
      const targetId = String(req.body?.userId ?? actor.id);
      if (targetId !== actor.id && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只能填写本人的拍剪数据");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const businessDate = String(req.body?.businessDate ?? today);
      if (!isIsoDate(businessDate) || businessDate > today) throw new HttpError(400, "业务日无效");
      const shootCount = parseCount(req.body?.shootCount, "拍摄数");
      const finishedCount = parseCount(req.body?.finishedCount, "成片数");
      const publishedCount = parseCount(req.body?.publishedCount, "已发布数");
      const inventorySnapshot = parseCount(req.body?.inventorySnapshot, "视频囤量", 10_000_000);
      const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
      const previous = await queryOne<{ inventory_snapshot: number }>(
        db,
        `SELECT inventory_snapshot FROM editor_reports
          WHERE user_id = $1 AND business_date < $2
          ORDER BY business_date DESC LIMIT 1`,
        [targetId, businessDate]
      );
      const suggested = (previous?.inventory_snapshot ?? 0) + finishedCount - publishedCount;
      const adjusted = inventorySnapshot !== suggested;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const existing = await queryOne<Record<string, unknown>>(
          client,
          `SELECT * FROM editor_reports WHERE user_id = $1 AND business_date = $2 FOR UPDATE`,
          [targetId, businessDate]
        );
        const unchanged = Boolean(
          existing &&
            Number(existing.shoot_count) === shootCount &&
            Number(existing.finished_count) === finishedCount &&
            Number(existing.published_count) === publishedCount &&
            Number(existing.inventory_snapshot) === inventorySnapshot &&
            (existing.note ?? null) === note
        );
        if (existing && unchanged) {
          await client.query("COMMIT");
          res.json({ report: serializeEditor(existing), suggestedInventory: suggested });
          return;
        }
        const saved = existing
          ? await queryOne(
              client,
              `UPDATE editor_reports
                  SET shoot_count = $2, finished_count = $3, published_count = $4,
                      inventory_snapshot = $5, inventory_adjusted = $6, note = $7, updated_at = now()
                WHERE id = $1
                RETURNING *`,
              [existing.id, shootCount, finishedCount, publishedCount, inventorySnapshot, adjusted, note]
            )
          : await queryOne(
              client,
              `INSERT INTO editor_reports (
                  user_id, business_date, shoot_count, finished_count, published_count,
                  inventory_snapshot, inventory_adjusted, note, last_submitted_by
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               RETURNING *`,
              [targetId, businessDate, shootCount, finishedCount, publishedCount, inventorySnapshot, adjusted, note, actor.id]
            );
        await recordSubmission(client, {
          table: "editor_reports",
          entityType: "editor_report",
          id: String(saved!.id),
          actorId: actor.id,
          changed: true,
          isNew: !existing,
          ip: req.ip
        });
        await writeAudit(client, {
          actorId: actor.id,
          action: "editor_report_upsert",
          entityType: "editor_report",
          entityId: String(saved!.id),
          after: { businessDate, shootCount, finishedCount, publishedCount, inventorySnapshot, suggested, adjusted },
          ip: req.ip
        });
        const fresh = await queryOne(client, "SELECT * FROM editor_reports WHERE id = $1", [saved!.id]);
        await client.query("COMMIT");
        res.json({ report: serializeEditor(fresh), suggestedInventory: suggested });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function assertSelfOrBoss(actor: Actor, targetId: string, message: string) {
  if (actor.id !== targetId && !isBossOrAdmin(actor)) {
    throw new HttpError(403, message);
  }
}

function emptyDate(value: unknown): string | null {
  const text = String(value ?? "");
  return text && isIsoDate(text) ? text : null;
}

function serializeOps(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    businessDate: toDateOnly(row.business_date),
    platform: row.platform,
    promoVideoCount: row.promo_video_count,
    promoCost: money(row.promo_cost),
    note: row.note,
    updatedAt: row.updated_at,
    ...reviewPublicFields(row)
  };
}

function serializeEditor(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    businessDate: toDateOnly(row.business_date),
    shootCount: row.shoot_count,
    finishedCount: row.finished_count,
    publishedCount: row.published_count,
    inventorySnapshot: row.inventory_snapshot,
    inventoryAdjusted: row.inventory_adjusted,
    note: row.note,
    updatedAt: row.updated_at,
    ...reviewPublicFields(row)
  };
}

function resolveListUserId(actor: Actor, raw: unknown, message: string): string | null {
  const requested = raw ? String(raw) : "";
  if (requested) {
    assertSelfOrBoss(actor, requested, message);
    return requested;
  }
  if (isBossOrAdmin(actor)) return null;
  return actor.id;
}

function money(value: unknown): string {
  return Number(value).toFixed(2);
}
