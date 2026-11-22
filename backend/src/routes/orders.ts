import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { businessToday, isIsoDate, toDateOnly } from "../lib/dates.js";
import { addMoney, formatMoney, parseMoney } from "../lib/money.js";
import { recordSubmission, reviewPublicFields } from "../lib/review.js";
import { HttpError, type OrderStatus } from "../types.js";
import { isBossOrAdmin, managedTeamIds, type Actor } from "../users.js";
import type { AppConfig } from "../config.js";

const STATUSES: OrderStatus[] = ["placed", "in_production", "shipped", "refunded"];

export function createOrderRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.use((req, _res, next) => {
    const actor = req.actor!;
    if (!["cs", "boss", "cs_supervisor"].includes(actor.role)) {
      next(new HttpError(403, "无权访问订单"));
      return;
    }
    next();
  });

  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const targetId = req.query.userId ? String(req.query.userId) : "";
      if (targetId && actor.role !== "cs_supervisor") assertCanViewOrders(actor, targetId);
      const userFilter = actor.role === "cs" ? actor.id : targetId;
      const scopes = actor.role === "cs_supervisor" ? await managedTeamIds(db, actor) : null;
      const filters = readFilters(req.query);
      const rows = await query(
        db,
        `SELECT o.*,EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id=o.id AND x.voided_at IS NULL) AS cancelled,EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.sourcing_no_settle) AS has_sourcing_no_settle,(CASE WHEN d.order_id IS NULL THEN o.amount ELSE COALESCE((SELECT sum(i.price_cny+i.buying_fee_cny) FROM order_items i WHERE i.order_id=o.id),o.amount) END)::numeric(14,2)::text AS booking_amount,d.persona_code,d.persona_name,d.live_room_code,d.host_name,d.customer_code,d.operator_name,d.deal_channel,d.project_line,u.display_name,u.service_account_label AS wechat_id,u.account_kind,t.id::text AS team_id,t.name AS team_name,EXISTS(SELECT 1 FROM order_details d WHERE d.order_id=o.id) AS workflow_enabled FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN order_details d ON d.order_id=o.id LEFT JOIN LATERAL (SELECT m.team_id FROM team_memberships m WHERE m.user_id=o.user_id AND m.start_date<=o.business_date AND (m.end_date IS NULL OR m.end_date>=o.business_date) ORDER BY m.start_date DESC LIMIT 1) mem ON TRUE LEFT JOIN teams t ON t.id=mem.team_id
          WHERE ($1 = '' OR o.user_id::text = $1)
            AND ($2::date IS NULL OR o.business_date >= $2)
            AND ($3::date IS NULL OR o.business_date <= $3)
            AND ($4::uuid[] IS NULL OR EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=o.user_id AND m.team_id=ANY($4::uuid[]) AND m.start_date<=o.business_date AND (m.end_date IS NULL OR m.end_date>=o.business_date)))
            AND ($5='' OR o.status::text=$5)
          ORDER BY o.business_date DESC, o.created_at DESC`,
        [userFilter, filters.from, filters.to, scopes, filters.status]
      );
      res.json({ orders: rows.map(serializeOrder), totals: { amount: addMoney(rows.map((row) => String(row.amount))), refunds: addMoney(rows.filter((row) => row.status === "refunded"&&!row.cancelled).map((row) => String(row.amount))),cancelled:addMoney(rows.filter(row=>row.cancelled).map(row=>String(row.amount))),
        // 与 BOSS 直播间营业额同口径：开单卡料价＋代购费，不含追加收费，排除跑单与历史退款标记源单。
        turnover:addMoney(rows.filter(row=>!row.cancelled&&row.status!=="refunded").map(row=>String(row.booking_amount))),turnoverCount:rows.filter(row=>!row.cancelled&&row.status!=="refunded").length } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/export", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const userFilter = actor.role === "cs" ? actor.id : String(req.query.userId ?? "");
      const scopes = actor.role === "cs_supervisor" ? await managedTeamIds(db, actor) : null;
      const filters = readFilters(req.query);
      const rows = await query(
        db,
        `SELECT o.*,EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id=o.id AND x.voided_at IS NULL) AS cancelled,d.persona_code,d.persona_name,d.live_room_code,d.host_name,d.customer_code,d.operator_name,u.service_account_label AS wechat_id,u.display_name FROM orders o
           JOIN users u ON u.id = o.user_id LEFT JOIN order_details d ON d.order_id=o.id
          WHERE ($1 = '' OR o.user_id::text = $1)
            AND ($2::date IS NULL OR o.business_date >= $2)
            AND ($3::date IS NULL OR o.business_date <= $3)
            AND ($4::uuid[] IS NULL OR EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=o.user_id AND m.team_id=ANY($4::uuid[]) AND m.start_date<=o.business_date AND (m.end_date IS NULL OR m.end_date>=o.business_date)))
            AND ($5='' OR o.status::text=$5)
          ORDER BY o.business_date, o.order_ref`,
        [userFilter, filters.from, filters.to, scopes, filters.status]
      );
      const lines = ["业务日,订单标识,录入人,人设ID,人设,直播间编号,主播,客户ID,对接客服,归属接待账号,客户备注,金额,状态,跑单状态,定制,商品成本,工费,运费"];
      for (const row of rows) {
        lines.push(
          [
            toDateOnly(row.business_date),
            csv(String(row.order_ref)),
            csv(String(row.display_name)),
            ...[row.persona_code,row.persona_name,row.live_room_code,row.host_name,row.customer_code,row.operator_name,row.wechat_id].map(v=>csv(String(v??""))),
            csv(String(row.customer_label ?? "")),
            money(row.amount),
            row.status,
            row.cancelled?'已跑单':'正常',
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
              custom_product_cost, labor_cost, shipping_cost, note, last_submitted_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
            payload.note,
            actor.id
          ]
        );
        await recordSubmission(db, {
          table: "orders",
          entityType: "order",
          id: String(saved!.id),
          actorId: actor.id,
          changed: true,
          isNew: true,
          ip: req.ip
        });
        await writeAudit(db, {
          actorId: actor.id,
          action: "order_create",
          entityType: "order",
          entityId: saved!.id,
          after: { orderRef: payload.orderRef, amount: payload.amount, status: payload.status },
          ip: req.ip
        });
        const fresh = await queryOne(db, "SELECT * FROM orders WHERE id = $1", [saved!.id]);
        res.status(201).json({ order: serializeOrder(fresh) });
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
      if ((await db.query("SELECT 1 FROM order_details WHERE order_id=$1", [existing.id])).rowCount) throw new HttpError(409, "明细订单请使用订单档案操作，金额由料子明细自动计算");
      if (existing.user_id !== actor.id && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "无权修改该订单");
      }
      const payload = readOrderBody({ ...existingMapped(existing), ...req.body }, config, true);
      const unchanged =
        toDateOnly(existing.business_date) === payload.businessDate &&
        String(existing.order_ref) === payload.orderRef &&
        (existing.customer_label ?? null) === payload.customerLabel &&
        Number(existing.amount) === Number(payload.amount) &&
        String(existing.status) === payload.status &&
        Boolean(existing.is_custom) === payload.isCustom &&
        Number(existing.custom_product_cost) === Number(payload.customProductCost) &&
        Number(existing.labor_cost) === Number(payload.laborCost) &&
        Number(existing.shipping_cost) === Number(payload.shippingCost) &&
        (existing.note ?? null) === payload.note;
      if (unchanged) {
        res.json({ order: serializeOrder(existing) });
        return;
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const saved = await queryOne(
          client,
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
        await recordSubmission(client, {
          table: "orders",
          entityType: "order",
          id: String(existing.id),
          actorId: actor.id,
          changed: true,
          isNew: false,
          ip: req.ip
        });
        await writeAudit(client, {
          actorId: actor.id,
          action: "order_update",
          entityType: "order",
          entityId: String(existing.id),
          before: { orderRef: existing.order_ref, amount: existing.amount, status: existing.status },
          after: { orderRef: payload.orderRef, amount: payload.amount, status: payload.status },
          ip: req.ip
        });
        const fresh = await queryOne(client, "SELECT * FROM orders WHERE id = $1", [existing.id]);
        await client.query("COMMIT");
        res.json({ order: serializeOrder(fresh ?? saved) });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (isUniqueViolation(error)) next(new HttpError(409, "订单标识已存在，不能重复录入"));
      else next(error);
    }
  });

  return router;
}

function readFilters(query: Record<string, unknown>) {
  const from = String(query.from ?? "");
  const to = String(query.to ?? "");
  const status = String(query.status ?? "");
  if (query.reviewStatus) throw new HttpError(400, "审核筛选已停用");
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to)) throw new HttpError(400, "日期区间无效");
  if (status && !STATUSES.includes(status as OrderStatus)) throw new HttpError(400, "订单状态无效");
  return { from: from || null, to: to || null, status };
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
    workflowEnabled: Boolean(row.workflow_enabled),
    userId: row.user_id,
    personaCode:row.persona_code,personaName:row.persona_name,liveRoomCode:row.live_room_code,hostName:row.host_name,customerCode:row.customer_code,operatorName:row.operator_name,dealChannel:row.deal_channel,projectLine:row.project_line,materialCostCny:row.material_cost_cny==null?null:money(row.material_cost_cny),materialLotNo:row.material_lot_no??"",hasSourcingNoSettle:Boolean(row.has_sourcing_no_settle),
    displayName: row.display_name,
    wechatId: row.wechat_id,
    accountKind: row.account_kind,
    teamId: row.team_id ?? null,
    teamName: row.team_name ?? null,
    cancelled: Boolean(row.cancelled),
    bookingAmount: row.booking_amount == null ? undefined : String(row.booking_amount),
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
    updatedAt: row.updated_at,
    ...reviewPublicFields(row)
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
  if(/^[=+@-]/.test(value))value="'"+value;
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "23505";
}
