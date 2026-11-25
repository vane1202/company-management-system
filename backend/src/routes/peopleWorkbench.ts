import { Router } from "express";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { query } from "../db.js";
import { managedTeamIds, type Actor } from "../users.js";
import { businessToday, isIsoDate } from "../lib/dates.js";
import { readableOrderTeamScope } from "../lib/commerce.js";
import { writeAudit } from "../audit.js";

const KINDS = new Set(["fans", "orders", "after-sales", "attendance"]);

async function scope(db: Pool, actor: Actor) {
  if (actor.role === "boss" || actor.role === "admin") return { all: true, teams: [] as string[], self: false };
  if (actor.role === "cs_supervisor") return { all: false, teams: await managedTeamIds(db, actor), self: false };
  if (actor.role === "cs") return { all: false, teams: [] as string[], self: true };
  throw new HttpError(403, "当前身份不能查看这些资料");
}


export function createPeopleWorkbenchRouter(db: Pool, _config: AppConfig): Router {
  const router = Router();

  router.get("/assessment/foundation", async (req, res, next) => {
    try {
      const actor = req.actor;
      if (!actor) throw new HttpError(401, "unauthorized");
      const visible = await scope(db, actor);
      const today = businessToday(new Date(), _config.businessTimezone);
      const teams = (await query<{ id: string; name: string }>(db,
        `SELECT id::text, name FROM teams WHERE is_active AND ($1::boolean OR id = ANY($2::uuid[])) ORDER BY name`,
        [visible.all, visible.teams])).map(row => ({ id: row.id, name: row.name }));
      const people = await query<{ id: string; code: string; name: string; active: boolean; team_id: string | null }>(db,
        `SELECT u.id::text, u.username AS code, u.display_name AS name, u.is_active AS active, m.team_id::text
           FROM users u
           LEFT JOIN LATERAL (
             SELECT team_id FROM team_memberships
              WHERE user_id = u.id AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE)
              ORDER BY start_date DESC LIMIT 1
           ) m ON TRUE
          WHERE u.role = 'cs' AND u.account_kind IN ('employee','cs_wechat','cs_service')
            AND ($1::boolean OR EXISTS(
              SELECT 1 FROM team_memberships tm
               WHERE tm.user_id = u.id
                 AND tm.team_id = ANY($2::uuid[])
                 AND tm.start_date <= CURRENT_DATE
                 AND (tm.end_date IS NULL OR tm.end_date >= CURRENT_DATE)
            ) OR ($3::boolean AND u.id = $4::uuid))
          ORDER BY u.display_name`,
        [visible.all, visible.teams, visible.self, actor.id]);
      const employees = people.map(row => ({ id: row.id, code: row.code, name: row.name, status: row.active ? "active" : "left", teamId: row.team_id || "" }));
      const leads = (await query<Record<string, string | null>>(db,
        `SELECT l.id::text, l.user_id::text AS account_id, l.received_on::text AS business_date, l.user_id::text AS employee_id,
                l.page_name, l.channel, l.contact_status, l.qualified_on::text AS qualified_on, l.invalid_reason,
                l.invalid_reason_code, l.invalid_review_status, l.attempt_contact,
                l.customer_label, l.operator_name, l.need_summary,
                EXISTS(SELECT 1 FROM orders o WHERE o.user_id = l.user_id AND o.customer_label = l.customer_label AND o.status <> 'refunded'
                   AND NOT EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL)) AS dealt
           FROM fan_leads l
          WHERE l.voided_at IS NULL AND ($1::boolean OR l.team_id = ANY($2::uuid[]) OR ($3::boolean AND l.user_id = $4::uuid))`,
        [visible.all, visible.teams, visible.self, actor.id])).map(row => {
          const confirmedInvalid = row.invalid_review_status === "approved";
          const reasonCode = ["no_chinese", "misclick", "obscene", "custom"].includes(String(row.invalid_reason_code || ""))
            ? String(row.invalid_reason_code)
            : (row.invalid_reason ? "custom" : "");
          return {
          id: row.id, accountId: row.account_id, businessDate: row.business_date, employeeId: row.employee_id,
          pageName: row.page_name || "", channel: row.channel === "ws" ? "ws" : "ms",
          contact: confirmedInvalid ? "invalid" : (["replied", "read_no_reply", "unread"].includes(String(row.contact_status)) ? row.contact_status : "unread"),
          qualified: confirmedInvalid ? false : !!row.qualified_on,
          invalidReason: confirmedInvalid ? reasonCode : "",
          customerLabel: row.customer_label || "",
          operatorName: row.operator_name || "",
          needSummary: row.need_summary || "",
          pendingReview: !confirmedInvalid && Boolean(row.invalid_reason) && row.invalid_review_status !== "approved",
          attemptContact: String(row.attempt_contact) === "true",
          dealt: String(row.dealt) === "true"
        };});
      const attendance = (await query<Record<string, string | number | null>>(db,
        `SELECT f.id::text, f.user_id::text AS account_id, f.business_date::text, f.user_id::text AS employee_id,
                COALESCE(NULLIF(f.page_name, ''), '未登记') AS room_name, f.added_count
           FROM fan_reports f
           LEFT JOIN LATERAL (
             SELECT team_id FROM team_memberships
              WHERE user_id = f.user_id AND start_date <= f.business_date AND (end_date IS NULL OR end_date >= f.business_date)
              ORDER BY start_date DESC LIMIT 1
           ) m ON TRUE
          WHERE ($1::boolean OR m.team_id = ANY($2::uuid[]) OR ($3::boolean AND f.user_id = $4::uuid))`,
        [visible.all, visible.teams, visible.self, actor.id])).map(row => ({
          id: String(row.id), accountId: String(row.account_id), businessDate: String(row.business_date), employeeId: String(row.employee_id),
          roomCode: "", roomName: String(row.room_name), enteredCount: Number(row.added_count) || 0,
          orderedCustomerIds: [], orderLink: "unlinked", source: "正式日报"
        }));
      const orders = (await query<Record<string, string | boolean>>(db,
        `SELECT o.id::text, o.user_id::text AS account_id, o.business_date::text, COALESCE(o.customer_label, '') AS customer_label,
                o.user_id::text AS employee_id, d.deal_channel,
                COALESCE(NULLIF(TRIM(d.operator_name), ''), '待确认归属') AS operator_name,
                CASE WHEN TRIM(d.project_line) IN ('志伟线', '志伟组') THEN '志伟组' ELSE t.name END AS team_name,
                CASE WHEN d.deal_channel = 'private' THEN
                  COALESCE((SELECT SUM(i.price_cny + i.buying_fee_cny) FROM order_items i WHERE i.order_id = o.id), o.amount)::numeric(14,2)::text
                END AS booking_amount,
                (o.status <> 'refunded' AND NOT EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL)) AS counts
           FROM orders o
           LEFT JOIN order_details d ON d.order_id = o.id
           LEFT JOIN LATERAL (
             SELECT team_id FROM team_memberships
              WHERE user_id = o.user_id AND start_date <= o.business_date AND (end_date IS NULL OR end_date >= o.business_date)
              ORDER BY start_date DESC LIMIT 1
           ) m ON TRUE
           LEFT JOIN teams t ON t.id = m.team_id
          WHERE ($1::boolean OR ${readableOrderTeamScope(2)} OR ($3::boolean AND o.user_id = $4::uuid))`,
        [visible.all, visible.teams, visible.self, actor.id]));
      const assessmentOrders = orders.map(row => ({
          id: row.id, accountId: row.account_id, businessDate: row.business_date, customerLabel: row.customer_label,
          employeeId: row.employee_id, countsAsOrder: row.counts === true || String(row.counts) === "true"
        }));
      const privateSales = orders.filter(row => row.deal_channel === "private").map(row => ({
        id: row.id, businessDate: row.business_date, operatorName: row.operator_name,
        customerLabel: row.customer_label, teamName: row.team_name, amount: row.booking_amount,
        cancelled: row.counts !== true && String(row.counts) !== "true"
      }));
      const view = actor.role === "cs" ? "capture" : "review";
      res.set("Cache-Control", "private, no-store").json({
        version: "assessment-foundation/v1", demo: false, today, view, employees, teams, leads, attendance, orders: assessmentOrders, privateSales,
        tenures: [], holderCheck: [], invalid: [], sourceAds: [], note: "正式数据：客资来自客户线索，加粉来自日报，订单来自开单记录。没有登记的日期不按 0 计算。"
      });
    } catch (error) { next(error); }
  });

  router.get("/report-history", async (req, res, next) => {
    try {
      const actor = req.actor;
      if (!actor || !["boss", "admin", "cs_supervisor", "cs"].includes(actor.role)) throw new HttpError(403, "当前身份不能查看这些资料");
      const kind = String(req.query.kind || "fans");
      if (!KINDS.has(kind)) throw new HttpError(400, "历史类别无效");
      const from = String(req.query.from || "");
      const to = String(req.query.to || "");
      if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new HttpError(400, "日期范围无效");
      const visible = await scope(db, actor);
      const accountFilter = String(req.query.accountId || "");
      const accounts = await query<{ id: string; label: string; team_name: string | null }>(db,
        `SELECT u.id::text, COALESCE(NULLIF(u.service_account_label, ''), NULLIF(u.wechat_id, ''), u.display_name) AS label, t.name AS team_name
           FROM users u
           LEFT JOIN LATERAL (
             SELECT team_id FROM team_memberships
              WHERE user_id = u.id AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE)
              ORDER BY start_date DESC LIMIT 1
           ) m ON TRUE
           LEFT JOIN teams t ON t.id = m.team_id
          WHERE u.role = 'cs' AND ($1::boolean OR m.team_id = ANY($2::uuid[]) OR ($3::boolean AND u.id = $4::uuid))
          ORDER BY label`,
        [visible.all, visible.teams, visible.self, actor.id]);
      let records: unknown[] = [];
      if (kind === "fans") {
        records = (await query<Record<string, string | number | null>>(db,
          `SELECT f.id::text, f.user_id::text AS account_id, f.business_date::text, f.added_count, f.valid_today, f.comm_invalid, f.page_name,
                  u.display_name, u.username, COALESCE(t.name, '未分组') AS team_name,
                  COALESCE(NULLIF(u.service_account_label,''), NULLIF(u.wechat_id,''), u.display_name) AS account_label
             FROM fan_reports f
             JOIN users u ON u.id = f.user_id
             LEFT JOIN LATERAL (
               SELECT team_id FROM team_memberships WHERE user_id = f.user_id AND start_date <= f.business_date AND (end_date IS NULL OR end_date >= f.business_date)
               ORDER BY start_date DESC LIMIT 1) m ON TRUE
             LEFT JOIN teams t ON t.id = m.team_id
            WHERE f.business_date BETWEEN $5::date AND $6::date
              AND ($1::boolean OR m.team_id = ANY($2::uuid[]) OR ($3::boolean AND f.user_id = $4::uuid))
              AND ($7::text = '' OR f.user_id::text = $7)
            ORDER BY f.business_date DESC, u.display_name`,
          [visible.all, visible.teams, visible.self, actor.id, from, to, accountFilter])).map(row => fieldRecord(row, "fans", "加粉日报", "正式日报", [
            ["added", "新增粉", row.added_count],
            ["valid", "有效粉", row.valid_today],
            ["invalid", "无效粉", row.comm_invalid],
            ["page", "主页", row.page_name]
          ]));
      } else if (kind === "orders") {
        records = (await query<Record<string, string | null>>(db,
          `SELECT o.id::text, o.user_id::text AS account_id, o.business_date::text, o.order_ref, COALESCE(o.customer_label,'') AS customer_label, o.amount::text AS amount, o.status,
                  u.display_name, u.username, COALESCE(t.name, '未分组') AS team_name,
                  COALESCE(NULLIF(u.service_account_label,''), NULLIF(u.wechat_id,''), u.display_name) AS account_label
             FROM orders o JOIN users u ON u.id = o.user_id
             LEFT JOIN LATERAL (
               SELECT team_id FROM team_memberships WHERE user_id = o.user_id AND start_date <= o.business_date AND (end_date IS NULL OR end_date >= o.business_date)
               ORDER BY start_date DESC LIMIT 1) m ON TRUE
             LEFT JOIN teams t ON t.id = m.team_id
            WHERE o.business_date BETWEEN $5::date AND $6::date
              AND ($1::boolean OR m.team_id = ANY($2::uuid[]) OR ($3::boolean AND o.user_id = $4::uuid))
              AND ($7::text = '' OR o.user_id::text = $7)
            ORDER BY o.business_date DESC, o.order_ref`,
          [visible.all, visible.teams, visible.self, actor.id, from, to, accountFilter])).map(row => fieldRecord(row, "orders", "开单记录", "正式订单", [
            ["ref", "订单号", row.order_ref],
            ["customer", "客户", row.customer_label],
            ["amount", "金额", row.amount],
            ["status", "状态", row.status]
          ]));
      } else if (kind === "after-sales") {
        records = (await query<Record<string, string | null>>(db,
          `SELECT e.id::text, o.user_id::text AS account_id, e.business_date::text, e.label, e.category, e.amount_cny::text AS amount, o.order_ref,
                  u.display_name, u.username, COALESCE(t.name, '未分组') AS team_name,
                  COALESCE(NULLIF(u.service_account_label,''), NULLIF(u.wechat_id,''), u.display_name) AS account_label
             FROM order_expenses e
             JOIN orders o ON o.id = e.order_id
             JOIN users u ON u.id = o.user_id
             LEFT JOIN LATERAL (
               SELECT team_id FROM team_memberships WHERE user_id = o.user_id AND start_date <= e.business_date AND (end_date IS NULL OR end_date >= e.business_date)
               ORDER BY start_date DESC LIMIT 1) m ON TRUE
             LEFT JOIN teams t ON t.id = m.team_id
            WHERE e.voided_at IS NULL AND e.business_date BETWEEN $5::date AND $6::date
              AND ($1::boolean OR m.team_id = ANY($2::uuid[]) OR ($3::boolean AND o.user_id = $4::uuid))
              AND ($7::text = '' OR o.user_id::text = $7)
            ORDER BY e.business_date DESC`,
          [visible.all, visible.teams, visible.self, actor.id, from, to, accountFilter])).map(row => fieldRecord(row, "after-sales", "售后费用", "正式费用", [
            ["order", "订单号", row.order_ref],
            ["label", "费用", row.label],
            ["amount", "金额", row.amount],
            ["category", "类别", row.category]
          ]));
      }
      res.set("Cache-Control", "private, no-store").json({
        records, accounts: accounts.map(row => ({ id: row.id, label: row.label, teamName: row.team_name || '未分组' })),
        canPreviewCorrections: false, demo: false
      });
    } catch (error) { next(error); }
  });

  router.get("/customer-reviews", async (req, res, next) => {
    try {
      const actor = req.actor;
      if (!actor || !["boss", "cs_supervisor"].includes(actor.role)) throw new HttpError(403, "当前身份不能查看这些资料");
      const visible = await scope(db, actor);
      const rows = await query<Record<string, string | boolean | null>>(db,
        `SELECT l.id::text, l.version, 
                CASE WHEN l.invalid_reason <> '' AND l.invalid_review_status <> 'approved' THEN 'pending'
                     WHEN l.invalid_review_status IN ('approved','rejected','restored') THEN l.invalid_review_status
                     ELSE '' END AS status,
                l.customer_label AS name, l.customer_ref, l.operator_name, t.name AS team_name,
                COALESCE(NULLIF(u.service_account_label,''), NULLIF(u.wechat_id,''), u.display_name) AS account_label,
                l.page_name, l.received_on::text AS created_on, l.invalid_reason AS reason, l.invalid_reason_code,
                l.attempt_contact, l.note, l.need_summary,
                l.invalid_review_note, l.created_at::text AS requested_at,
                EXISTS(SELECT 1 FROM orders o WHERE o.user_id = l.user_id AND o.customer_label = l.customer_label AND o.status <> 'refunded'
                   AND NOT EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL)) AS dealt
           FROM fan_leads l
           JOIN teams t ON t.id = l.team_id
           JOIN users u ON u.id = l.user_id
          WHERE l.voided_at IS NULL AND (l.invalid_reason <> '' OR l.invalid_review_status <> '')
            AND ($1::boolean OR l.team_id = ANY($2::uuid[]))
          ORDER BY l.received_on DESC, l.created_at DESC`,
        [visible.all, visible.teams]);
      res.set("Cache-Control", "private, no-store").json({ rows: rows.map(presentReview) });
    } catch (error) { next(error); }
  });

  router.post("/customer-reviews/:id", async (req, res, next) => {
    const client = await db.connect();
    try {
      const actor = req.actor;
      if (!actor || actor.role !== "cs_supervisor") throw new HttpError(403, "当前身份不能查看这些资料");
      const decision = String(req.body?.decision || "");
      if (!["approve", "reject", "restore"].includes(decision)) throw new HttpError(400, "复核结果无效");
      const noteText = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (decision !== "approve" && !noteText) throw new HttpError(400, "退回或恢复必须填写原因");
      const visible = await scope(db, actor);
      await client.query("BEGIN");
      const current = (await client.query(
        `SELECT id::text, version, invalid_reason, invalid_review_status, team_id::text FROM fan_leads WHERE id = $1 AND voided_at IS NULL FOR UPDATE`,
        [req.params.id])).rows[0];
      if (!current) throw new HttpError(404, "复核记录不存在");
      if (!visible.all && !visible.teams.includes(current.team_id)) throw new HttpError(403, "当前身份不能查看这些资料");
      if (Number(req.body?.version) !== Number(current.version)) throw new HttpError(409, "记录已更新，请刷新后重试");
      const pending = Boolean(current.invalid_reason) && current.invalid_review_status !== "approved";
      const restorable = current.invalid_review_status === "approved";
      if (decision === "restore" ? !restorable : !pending) throw new HttpError(409, "这条客资不在待复核");
      const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "restored";
      await client.query(
        `UPDATE fan_leads
            SET invalid_review_status = $2,
                invalid_review_note = $3,
                invalid_reviewed_by = $4,
                invalid_reviewed_at = now(),
                invalid_reason = CASE WHEN $2 = 'approved' THEN invalid_reason ELSE '' END,
                invalid_reason_code = CASE WHEN $2 = 'approved' THEN invalid_reason_code ELSE '' END,
                attempt_contact = CASE WHEN $2 = 'approved' THEN FALSE ELSE TRUE END,
                version = version + 1,
                updated_by = $4,
                updated_at = now()
          WHERE id = $1`,
        [current.id, status, noteText.slice(0, 500), actor.id]);
      await writeAudit(client, { actorId: actor.id, action: "customer_review_" + decision, entityType: "fan_lead", entityId: current.id, after: { status, note: noteText }, ip: req.ip });
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally { client.release(); }
  });

  return router;
}

function fieldRecord(row: Record<string, unknown>, kind: string, title: string, source: string, fields: [string, string, unknown][]) {
  return {
    id: String(row.id), kind, accountId: String(row.account_id), accountLabel: String(row.account_label || ""),
    teamName: String(row.team_name || '未分组'), businessDate: String(row.business_date),
    employeeName: String(row.display_name || ""), employeeCode: String(row.username || ""),
    title, source, version: 1,
    fields: fields.map(([key, label, value]) => ({ key, label, value: value == null ? "" : String(value), type: key === "amount" ? "money" : "text", editable: false }))
  };
}

function presentReview(row: Record<string, unknown>) {
  return {
    id: String(row.id), version: Number(row.version), status: String(row.status), name: String(row.name || ""),
    customerRef: String(row.customer_ref || ""), employeeName: String(row.operator_name || ""), teamName: String(row.team_name || ""),
    accountLabel: String(row.account_label || ""), source: String(row.page_name || ""), createdOn: String(row.created_on || ""),
    reason: String(row.reason || ""), reasonCode: String(row.invalid_reason_code || ""),
    attemptContact: row.attempt_contact === true || String(row.attempt_contact) === "true",
    note: String(row.note || ""), need: String(row.need_summary || ""),
    reviewNote: String(row.invalid_review_note || ""), requestedAt: String(row.requested_at || ""), dealt: row.dealt === true || String(row.dealt) === "true"
  };
}
