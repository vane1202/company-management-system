import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { businessToday, isIsoDate } from "../lib/dates.js";
import { centsToMoney, moneyToCents, parseMoney } from "../lib/money.js";
import { writeAudit } from "../audit.js";

const DAILY_CATEGORIES = new Set(["rent", "utilities", "hospitality", "other"]);
const CLAIM_CATEGORIES: Record<string, string> = {
  temporary: "临时支出",
  advance: "业务垫付",
  travel: "差旅外出",
  purchase: "临时采购",
  other: "其他报销"
};

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `请填写${label}`);
  }
  return value.trim();
}

function dateOnOrBefore(value: unknown, today: string, label: string): string {
  if (typeof value !== "string" || !isIsoDate(value) || value > today) {
    throw new HttpError(400, `${label}无效或晚于今日`);
  }
  return value;
}

function financeOnly(role: string | undefined) {
  if (role !== "finance") throw new HttpError(403, "仅财务可登记");
}

async function pendingExpense(client: PoolClient, expenseId: string) {
  const row = (await client.query<{ amount_cny: string; paid_cny: string; voided_at: string | null; payment_tracking_started: boolean }>(
    `SELECT e.amount_cny::text AS amount_cny,
            COALESCE((SELECT sum(p.amount_cny) FROM supplier_payments p WHERE p.expense_id = e.id AND p.voided_at IS NULL), 0)::text AS paid_cny,
            e.voided_at::text AS voided_at,
            e.payment_tracking_started
       FROM order_expenses e
      WHERE e.id = $1
      FOR UPDATE`,
    [expenseId]
  )).rows[0];
  if (!row || row.voided_at || !row.payment_tracking_started) throw new HttpError(400, "关联费用不存在、已作废或未开始付款跟踪");
  const pending = moneyToCents(row.amount_cny) - moneyToCents(row.paid_cny);
  return pending > 0n ? pending : 0n;
}

export function createOperatingFinanceRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/daily-expenses", async (req, res, next) => {
    try {
      if (!req.actor || !["finance", "boss"].includes(req.actor.role)) throw new HttpError(403, "仅财务或 BOSS 可查看日常费用");
      const rows = (await db.query(
        `SELECT e.id::text AS id, e.category, e.business_date::text AS date, e.amount_cny::text AS amount,
                e.purpose, e.operator_name AS operator, e.proof
           FROM daily_operating_expenses e
          WHERE e.voided_at IS NULL
          ORDER BY e.business_date, e.created_at`
      )).rows;
      res.set("Cache-Control", "private, no-store").json({ records: rows });
    } catch (error) { next(error); }
  });

  router.post("/daily-expenses", async (req, res, next) => {
    const client = await db.connect();
    try {
      financeOnly(req.actor?.role);
      const today = businessToday(new Date(), config.businessTimezone);
      const body = req.body ?? {};
      if (!DAILY_CATEGORIES.has(body.category)) throw new HttpError(400, "工资由工资核算汇总，广告和业务费用不在此登记");
      const date = dateOnOrBefore(body.date, today, "费用日期");
      const amount = parseMoney(body.amount, "金额");
      if (moneyToCents(amount) <= 0n) throw new HttpError(400, "请填写有效正数金额");
      const purpose = text(body.purpose, "用途", 300);
      const operator = text(body.operator, "经办人", 64);
      const proof = typeof body.proof === "string" ? body.proof.trim().slice(0, 200) : "";
      await client.query("BEGIN");
      const saved = (await client.query(
        `INSERT INTO daily_operating_expenses (category, business_date, amount_cny, purpose, operator_name, proof, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id::text AS id, category, business_date::text AS date, amount_cny::text AS amount, purpose, operator_name AS operator, proof`,
        [body.category, date, amount, purpose, operator, proof, req.actor!.id]
      )).rows[0];
      await writeAudit(client, { actorId: req.actor!.id, action: "daily_expense_create", entityType: "daily_operating_expense", entityId: saved.id, after: saved, ip: req.ip });
      await client.query("COMMIT");
      const records = (await db.query(
        `SELECT id::text AS id, category, business_date::text AS date, amount_cny::text AS amount, purpose, operator_name AS operator, proof
           FROM daily_operating_expenses WHERE voided_at IS NULL ORDER BY business_date, created_at`
      )).rows;
      res.status(201).json({ records });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally { client.release(); }
  });

  router.all("/reimbursements", async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "POST") { next(); return; }
    const client = await db.connect();
    try {
      financeOnly(req.actor?.role);
      const today = businessToday(new Date(), config.businessTimezone);
      await client.query("BEGIN");
      if (req.method === "POST") await applyReimbursement(client, req.body ?? {}, { actorId: req.actor!.id, actorName: req.actor!.displayName, today, ip: req.ip });
      const payload = await reimbursementSnapshot(client);
      await client.query("COMMIT");
      res.set("Cache-Control", "private, no-store").json(payload);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally { client.release(); }
  });

  return router;
}

async function reimbursementSnapshot(client: PoolClient) {
  const claims = (await client.query(
    `SELECT id::text AS id, claimant, department, category, purpose, amount_cny::text AS amount,
            expense_date::text AS "expenseDate", claim_date::text AS "claimDate",
            COALESCE(expense_id::text, '') AS "expenseId", receipt_ref AS "receiptRef", note, status, version,
            created_by::text AS "createdBy", review_note AS "reviewNote", reviewed_by::text AS "reviewedBy"
       FROM reimbursement_claims
      ORDER BY created_at, id`
  )).rows;
  const payments = (await client.query(
    `SELECT id::text AS id, claim_id::text AS "claimId", amount_cny::text AS amount, paid_on::text AS date,
            payee, account, reference
       FROM reimbursement_payments
      ORDER BY paid_on, created_at`
  )).rows;
  const expenses = (await client.query(
    `SELECT e.id, o.order_ref, e.label, e.amount_cny::text AS amount_cny,
            COALESCE((SELECT sum(p.amount_cny) FROM supplier_payments p WHERE p.expense_id = e.id AND p.voided_at IS NULL), 0)::text AS paid_cny
       FROM order_expenses e
       JOIN orders o ON o.id = e.order_id
      WHERE e.voided_at IS NULL AND e.payment_tracking_started
      ORDER BY e.business_date DESC`
  )).rows.flatMap((row) => {
    const pending = moneyToCents(row.amount_cny) - moneyToCents(row.paid_cny);
    if (pending <= 0n) return [];
    return [{ id: row.id, order_ref: row.order_ref, label: row.label, pending_cny: centsToMoney(pending) }];
  });
  return { state: { claims, payments }, categories: CLAIM_CATEGORIES, expenses };
}

async function applyReimbursement(client: PoolClient, input: Record<string, unknown>, ctx: { actorId: string; actorName: string; today: string; ip?: string }) {
  if (input.action === "create") {
    const requestKey = text(input.requestKey, "请求编号", 80);
    const existing = await client.query("SELECT 1 FROM reimbursement_claims WHERE request_key = $1", [requestKey]);
    if (existing.rowCount) return;
    if (!Object.prototype.hasOwnProperty.call(CLAIM_CATEGORIES, String(input.category))) throw new HttpError(400, "报销类别无效");
    const amount = parseMoney(input.amount, "报销金额");
    if (moneyToCents(amount) <= 0n) throw new HttpError(400, "报销金额必须大于0");
    const expenseId = typeof input.expenseId === "string" && input.expenseId ? input.expenseId : null;
    if (expenseId) {
      const pending = await pendingExpense(client, expenseId);
      if (moneyToCents(amount) > pending) throw new HttpError(400, "报销金额超过关联费用待付金额");
      const duplicate = await client.query("SELECT 1 FROM reimbursement_claims WHERE expense_id = $1 AND status <> 'rejected'", [expenseId]);
      if (duplicate.rowCount) throw new HttpError(409, "该费用已有报销单，请勿重复登记");
    }
    const claimant = text(input.claimant, "报销人", 128);
    const receipt = text(input.receiptRef, "凭证编号", 128);
    const duplicateReceipt = await client.query("SELECT 1 FROM reimbursement_claims WHERE status <> 'rejected' AND claimant = $1 AND receipt_ref = $2", [claimant, receipt]);
    if (duplicateReceipt.rowCount) throw new HttpError(409, "该报销人与凭证已有报销单，请核对");
    const expenseDate = dateOnOrBefore(input.expenseDate, ctx.today, "费用日期");
    const claimDate = dateOnOrBefore(input.claimDate, ctx.today, "报销登记日期");
    if (expenseDate > claimDate) throw new HttpError(400, "费用日期不能晚于报销登记日期");
    const department = typeof input.department === "string" ? input.department.trim().slice(0, 64) : "";
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
    const saved = (await client.query(
      `INSERT INTO reimbursement_claims
        (request_key, claimant, department, category, purpose, amount_cny, expense_date, claim_date, expense_id, receipt_ref, note, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
       RETURNING id`,
      [requestKey, claimant, department, input.category, text(input.purpose, "报销事由", 500), amount, expenseDate, claimDate, expenseId, receipt, note, ctx.actorId]
    )).rows[0];
    await writeAudit(client, { actorId: ctx.actorId, action: "reimbursement_create", entityType: "reimbursement_claim", entityId: saved.id, after: input, ip: ctx.ip });
    return;
  }

  const id = text(input.id, "报销单", 80);
  const claim = (await client.query<{ id: string; status: string; version: number; amount_cny: string; expense_id: string | null; expense_date: string; claimant: string }>(
    `SELECT id::text, status, version, amount_cny::text, expense_id::text, expense_date::text, claimant
       FROM reimbursement_claims WHERE id = $1 FOR UPDATE`,
    [id]
  )).rows[0];
  if (!claim) throw new HttpError(404, "报销单不存在");
  if (Number(input.version) !== claim.version) throw new HttpError(409, "报销单已更新，请刷新后重试");

  if (input.action === "review") {
    if (claim.status !== "pending") throw new HttpError(409, "该报销单已处理");
    if (input.decision !== "approved" && input.decision !== "rejected") throw new HttpError(400, "核对结果无效");
    const reason = text(input.reason, "核对说明", 500);
    if (input.decision === "approved" && claim.expense_id) {
      const pending = await pendingExpense(client, claim.expense_id);
      if (moneyToCents(claim.amount_cny) > pending) throw new HttpError(409, "关联费用待付余额已变化，请核对");
    }
    await client.query(
      `UPDATE reimbursement_claims
          SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), version = version + 1
        WHERE id = $1`,
      [claim.id, input.decision, reason, ctx.actorId]
    );
    await writeAudit(client, { actorId: ctx.actorId, action: "reimbursement_review", entityType: "reimbursement_claim", entityId: claim.id, after: { decision: input.decision, reason }, ip: ctx.ip });
    return;
  }

  if (input.action === "pay") {
    if (claim.status !== "approved") throw new HttpError(409, "请先核对确认报销单");
    const reference = text(input.reference, "付款流水号", 128);
    const account = text(input.account, "付款账户", 128);
    const duplicate = await client.query(
      `SELECT 1 FROM reimbursement_payments WHERE reference = $1
       UNION ALL
       SELECT 1 FROM supplier_payments WHERE reference = $1 AND account = $2 AND voided_at IS NULL
       LIMIT 1`,
      [reference, account]
    );
    if (duplicate.rowCount) throw new HttpError(409, "该付款流水号已登记");
    const paid = (await client.query<{ total: string }>(
      "SELECT COALESCE(sum(amount_cny), 0)::text AS total FROM reimbursement_payments WHERE claim_id = $1",
      [claim.id]
    )).rows[0].total;
    const amount = parseMoney(input.amount, "付款金额");
    if (moneyToCents(amount) <= 0n || moneyToCents(amount) + moneyToCents(paid) > moneyToCents(claim.amount_cny)) {
      throw new HttpError(400, "付款金额超过剩余待报销金额");
    }
    if (claim.expense_id) {
      const pending = await pendingExpense(client, claim.expense_id);
      if (moneyToCents(amount) > pending) throw new HttpError(400, "付款金额超过关联费用剩余待付");
    }
    const paidOn = dateOnOrBefore(input.date, ctx.today, "付款日期");
    if (paidOn < claim.expense_date) throw new HttpError(400, "付款日期不能早于费用日期");
    const payee = text(input.payee, "收款人", 128);
    const saved = (await client.query(
      `INSERT INTO reimbursement_payments (claim_id, amount_cny, paid_on, payee, account, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [claim.id, amount, paidOn, payee, account, reference, ctx.actorId]
    )).rows[0];
    await client.query("UPDATE reimbursement_claims SET version = version + 1 WHERE id = $1", [claim.id]);
    await writeAudit(client, { actorId: ctx.actorId, action: "reimbursement_pay", entityType: "reimbursement_payment", entityId: saved.id, after: { claimId: claim.id, amount, reference }, ip: ctx.ip });
    return;
  }
  throw new HttpError(405, "不支持此操作");
}
