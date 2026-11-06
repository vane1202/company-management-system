import { Router } from "express";
import type { Pool } from "pg";
import { query } from "../db.js";
import { isIsoDate, toDateOnly } from "../lib/dates.js";
import { formatMoney } from "../lib/money.js";
import {
  REVIEW_ENTITY,
  applyReview,
  assertCanViewReviews,
  listReviewHistory,
  parseReviewEntityType,
  parseReviewStatus,
  reviewPublicFields,
  type ReviewEntityType,
  type ReviewStatus
} from "../lib/review.js";
import { HttpError } from "../types.js";

export function createReviewRouter(db: Pool): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      assertCanViewReviews(actor);
      const status = req.query.status ? parseReviewStatus(req.query.status) : undefined;
      const entityType = req.query.entityType ? parseReviewEntityType(req.query.entityType) : undefined;
      const from = emptyDate(req.query.from);
      const to = emptyDate(req.query.to);
      const types: ReviewEntityType[] = entityType ? [entityType] : ["ops_report", "editor_report", "fan_report", "order"];
      const items: Record<string, unknown>[] = [];
      for (const type of types) {
        items.push(...(await listEntities(db, type, status, from, to)));
      }
      items.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      res.json({
        items,
        note: "助理只能审核日常填报，不能修改业务数值，也不能查看工资或经营估算。"
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:entityType/:id/history", async (req, res, next) => {
    try {
      const actor = req.actor!;
      assertCanViewReviews(actor);
      const entityType = parseReviewEntityType(req.params.entityType);
      const rows = await listReviewHistory(db, entityType, String(req.params.id));
      res.json({
        history: rows.map((row) => ({
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          reviewVersion: Number(row.review_version),
          action: row.action,
          reason: row.reason,
          actorId: row.actor_id,
          actorName: row.actor_name,
          beforeStatus: row.before_status,
          afterStatus: row.after_status,
          createdAt: row.created_at
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const entityType = parseReviewEntityType(req.body?.entityType);
      const entityId = String(req.body?.entityId ?? "");
      const actionRaw = String(req.body?.action ?? "");
      if (!entityId) throw new HttpError(400, "请指定要审核的记录");
      if (actionRaw !== "approve" && actionRaw !== "reject") {
        throw new HttpError(400, "审核动作无效");
      }
      const version = Number(req.body?.version);
      const saved = await applyReview(db, req.actor!, {
        entityType,
        entityId,
        action: actionRaw,
        reason: req.body?.reason ? String(req.body.reason) : "",
        version,
        ip: req.ip
      });
      res.json({
        item: serializeSaved(entityType, saved),
        message: actionRaw === "approve" ? "已通过" : "已退回"
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function listEntities(
  db: Pool,
  entityType: ReviewEntityType,
  status: ReviewStatus | undefined,
  from: string | null,
  to: string | null
): Promise<Record<string, unknown>[]> {
  const table = REVIEW_ENTITY[entityType].table;
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT r.*, u.display_name, u.username
       FROM ${table} r
       JOIN users u ON u.id = r.user_id
      WHERE ($1::review_status IS NULL OR r.review_status = $1)
        AND ($2::date IS NULL OR r.business_date >= $2)
        AND ($3::date IS NULL OR r.business_date <= $3)
      ORDER BY r.updated_at DESC`,
    [status ?? null, from, to]
  );
  return rows.map((row) => serializeSaved(entityType, row));
}

function serializeSaved(entityType: ReviewEntityType, row: Record<string, unknown>) {
  const base = {
    id: row.id,
    entityType,
    entityLabel: REVIEW_ENTITY[entityType].label,
    userId: row.user_id,
    displayName: row.display_name ?? null,
    username: row.username ?? null,
    businessDate: toDateOnly(row.business_date),
    updatedAt: row.updated_at,
    ...reviewPublicFields(row)
  };
  if (entityType === "ops_report") {
    return {
      ...base,
      payload: {
        platform: row.platform,
        promoVideoCount: row.promo_video_count,
        promoCost: money(row.promo_cost),
        note: row.note
      }
    };
  }
  if (entityType === "editor_report") {
    return {
      ...base,
      payload: {
        shootCount: row.shoot_count,
        finishedCount: row.finished_count,
        publishedCount: row.published_count,
        inventorySnapshot: row.inventory_snapshot,
        inventoryAdjusted: row.inventory_adjusted,
        note: row.note
      }
    };
  }
  if (entityType === "fan_report") {
    return {
      ...base,
      payload: {
        addedCount: row.added_count,
        teamId: row.team_id
      }
    };
  }
  return {
    ...base,
    payload: {
      orderRef: row.order_ref,
      customerLabel: row.customer_label,
      amount: money(row.amount),
      status: row.status,
      isCustom: row.is_custom,
      customProductCost: money(row.custom_product_cost),
      laborCost: money(row.labor_cost),
      shippingCost: money(row.shipping_cost),
      note: row.note
    }
  };
}

function emptyDate(value: unknown): string | null {
  const text = String(value ?? "");
  return text && isIsoDate(text) ? text : null;
}

function money(value: unknown): string {
  return formatMoney(value ?? 0);
}

