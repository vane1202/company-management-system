import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { businessToday, isIsoDate, toDateOnly } from "../lib/dates.js";
import { formatMoney, parseMoney } from "../lib/money.js";
import { HttpError, type OrderStatus } from "../types.js";
import { isBossOrAdmin, type Actor } from "../users.js";
import type { AppConfig } from "../config.js";

const STATUSES: OrderStatus[] = ["placed", "in_production", "shipped", "refunded"];

export function createOrderRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.use((req, _res, next) => {
    const actor = req.actor!;
    if (actor.role === "cs_supervisor") {
      next(new HttpError(403, "客服主管不能查看订单或消费数据"));
      return;
    }
    if (!["cs", "boss", "admin"].includes(actor.role)) {
      next(new HttpError(403, "无权访问订单"));
      return;
    }
    next();
  });

  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const targetId = req.query.userId ? String(req.query.userId) : "";
      if (targetId) assertCanViewOrders(actor, targetId);
      const userFilter = isBossOrAdmin(actor) ? targetId : actor.id;
      const rows = await query(
        db,
        `SELECT * FROM orders
          WHERE ($1 = '' OR user_id::text = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
          ORDER BY business_date DESC, created_at DESC`,
        [userFilter, emptyDate(req.query.from), emptyDate(req.query.to)]
      );
      res.json({ orders: rows.map(serializeOrder) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/export", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const userFilter = isBossOrAdmin(actor) ? String(req.query.userId ?? "") : actor.id;
      const rows = await query(
        db,
        `SELECT o.*, u.display_name FROM orders o
           JOIN users u ON u.id = o.user_id
          WHERE ($1 = '' OR o.user_id::text = $1)
            AND ($2::date IS NULL OR o.business_date >= $2)
            AND ($3::date IS NULL OR o.business_date <= $3)
          ORDER BY o.business_date, o.order_ref`,
        [userFilter, emptyDate(req.query.from), emptyDate(req.query.to)]
      );
      const lines = ["业务日,订单标识,录入人,客户备注,金额,状态,定制,商品成本,工费,运费"];
      for (const row of rows) {
        lines.push(
          [
            toDateOnly(row.business_date),
            csv(String(row.order_ref)),
            csv(String(row.display_name)),
            csv(String(row.customer_label ?? "")),
            money(row.amount),
            row.status,
            row.is_custom ? "是" : "否",
            money(row.custom_product_cost),
            money(row.labor_cost),
            money(row.shipping_cost)
          ].join(",")
        );
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=orders.csv");
      res.send(`\uFEFF${lines.join("\n")}`);
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role !== "cs" && !isBossOrAdmin(actor)) throw new HttpError(403, "只有客服可以录入订单");
      const payload = readOrderBody(req.body, config);
      const targetId = String(req.body?.userId ?? actor.id);
      if (targetId !== actor.id && !isBossOrAdmin(actor)) throw new HttpError(403, "只能录入本人订单");
      try {
        const saved = await queryOne(
          db,
          `INSERT INTO orders (
              user_id, business_date, order_ref, customer_label, amount, status, is_custom,
              custom_product_cost, labor_cost, shipping_cost, note
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            targetId,
            payload.businessDate,
            payload.orderRef,
            payload.customerLabel,
            payload.amount,
            payload.status,
            payload.isCustom,
            payload.customProductCost,
            payload.laborCost,
            payload.shippingCost,
            payload.note
          ]
        );
        await writeAudit(db, {
          actorId: actor.id,
          action: "order_create",
          entityType: "order",
          entityId: saved!.id,
          after: { orderRef: payload.orderRef, amount: payload.amount, status: payload.status },
          ip: req.ip
        });
        res.status(201).json({ order: serializeOrder(saved) });
      } catch (error) {
        if (isUniqueViolation(error)) throw new HttpError(409, "订单标识已存在，不能重复录入");
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const existing = await queryOne<Record<string, unknown>>(db, "SELECT * FROM orders WHERE id = $1", [
        req.params.id
      ]);
      if (!existing) throw new HttpError(404, "订单不存在");
      if (existing.user_id !== actor.id && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "无权修改该订单");
      }
      const payload = readOrderBody({ ...existingMapped(existing), ...req.body }, config, true);
      const saved = await queryOne(
        db,
        `UPDATE orders SET
            business_date = $1, order_ref = $2, customer_label = $3, amount = $4, status = $5,
            is_custom = $6, custom_product_cost = $7, labor_cost = $8, shipping_cost = $9, note = $10,
            updated_at = now()
          WHERE id = $11
          RETURNING *`,
        [
          payload.businessDate,
          payload.orderRef,
          payload.customerLabel,
          payload.amount,
          payload.status,
          payload.isCustom,
          payload.customProductCost,
          payload.laborCost,
          payload.shippingCost,
          payload.note,
          existing.id
        ]
      );
      await writeAudit(db, {
        actorId: actor.id,
        action: "order_update",
        entityType: "order",
        entityId: String(existing.id),
        before: { orderRef: existing.order_ref, amount: existing.amount, status: existing.status },
        after: { orderRef: payload.orderRef, amount: payload.amount, status: payload.status },
        ip: req.ip
      });
      res.json({ order: serializeOrder(saved) });
    } catch (error) {
      if (isUniqueViolation(error)) next(new HttpError(409, "订单标识已存在，不能重复录入"));
      else next(error);
    }
  });

  return router;
}

function assertCanViewOrders(actor: Actor, targetId: string) {
  if (actor.id !== targetId && !isBossOrAdmin(actor)) {
    throw new HttpError(403, "无权查看他人订单");
  }
}

function readOrderBody(body: Record<string, unknown>, config: AppConfig, partial = false) {
  const today = businessToday(new Date(), config.businessTimezone);
  const businessDate = String(body.businessDate ?? body.business_date ?? today);
  if (!isIsoDate(businessDate) || businessDate > today) throw new HttpError(400, "业务日无效");
  const orderRef = String(body.orderRef ?? body.order_ref ?? "").trim();
  if (!orderRef || orderRef.length > 64) throw new HttpError(400, "请填写不超过 64 字的订单标识");
  const customerLabelRaw = body.customerLabel ?? body.customer_label;
  const customerLabel = customerLabelRaw ? String(customerLabelRaw).trim().slice(0, 64) : null;
  const amount = parseMoney(body.amount ?? "0", "消费金额");
  const status = String(body.status ?? "placed") as OrderStatus;
  if (!STATUSES.includes(status)) throw new HttpError(400, "订单状态无效");
  const isCustom = Boolean(body.isCustom ?? body.is_custom);
  const customProductCost = parseMoney(body.customProductCost ?? body.custom_product_cost ?? "0", "定制商品成本");
  const laborCost = parseMoney(body.laborCost ?? body.labor_cost ?? "0", "工费");
  const shippingCost = parseMoney(body.shippingCost ?? body.shipping_cost ?? "0", "运费");
  const note = body.note ? String(body.note).slice(0, 500) : null;
  void partial;
  return {
    businessDate,
    orderRef,
    customerLabel,
    amount,
    status,
    isCustom,
    customProductCost,
    laborCost,
    shippingCost,
    note
  };
}

function existingMapped(row: Record<string, unknown>) {
  return {
    businessDate: toDateOnly(row.business_date),
    orderRef: row.order_ref,
    customerLabel: row.customer_label,
    amount: money(row.amount),
    status: row.status,
    isCustom: row.is_custom,
    customProductCost: money(row.custom_product_cost),
    laborCost: money(row.labor_cost),
    shippingCost: money(row.shipping_cost),
    note: row.note
  };
}

function serializeOrder(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    businessDate: toDateOnly(row.business_date),
    orderRef: row.order_ref,
    customerLabel: row.customer_label,
    amount: money(row.amount),
    status: row.status,
    isCustom: row.is_custom,
    customProductCost: money(row.custom_product_cost),
    laborCost: money(row.labor_cost),
    shippingCost: money(row.shipping_cost),
    note: row.note,
    updatedAt: row.updated_at
  };
}

function emptyDate(value: unknown): string | null {
  const text = String(value ?? "");
  return text && isIsoDate(text) ? text : null;
}

function money(value: unknown): string {
  return formatMoney(value);
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23505";
}
