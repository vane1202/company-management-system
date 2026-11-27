import { createHash, randomUUID } from "node:crypto";
import { json, Router } from "express";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { businessToday, isIsoDate } from "../lib/dates.js";
import { centsToMoney, moneyToCents, parseMoney } from "../lib/money.js";
import { writeAudit } from "../audit.js";
import { managedTeamIds, type Actor } from "../users.js";
import { uuid } from "../lib/commerce.js";
import { teamOrderSql } from "../lib/teamOrder.js";

function reimbursementActor(actor: Actor | undefined): Actor {
  if (actor?.role === "finance" || actor?.role === "cs_supervisor" ||
      (actor?.role === "cs" && actor.accountKind === "employee")) return actor;
  throw new HttpError(403, "仅财务、客服员工和客服主管可访问报销");
}

function claimScope(actor: Actor, teams: string[]): { where: string; args: (string | string[])[] } {
  if (actor.role === "finance") return { where: "c.workflow_stage IN ('finance','historical')", args: [] };
  if (actor.role === "cs_supervisor") return { where: "c.team_id = ANY($1::uuid[])", args: [teams] };
  return { where: "c.created_by = $1 AND c.team_id IS NOT NULL", args: [actor.id] };
}

function readProof(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "凭证图片格式无效");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new HttpError(400, "凭证支持 JPG、PNG 或 WebP");
  const [,mime,encoded] = match;
  const bytes = Buffer.from(encoded,"base64");
  const valid = mime === "image/png" ? bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex")) :
    mime === "image/jpeg" ? bytes.subarray(0,3).equals(Buffer.from("ffd8ff","hex")) :
    bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  if (!valid || bytes.toString("base64") !== encoded || bytes.length > 5 * 1024 * 1024) {
    throw new HttpError(400, "凭证图片损坏或超过 5 MB");
  }
  return { mime, bytes };
}

const DAILY_CATEGORIES = new Set(["rent", "utilities", "hospitality", "other"]);
const CLAIM_CATEGORIES: Record<string, string> = {
  temporary: "临时支出",
  advance: "业务垫付",
  travel: "差旅外出",
  purchase: "临时采购",
  other: "其他报销"
};
const CLAIM_TYPES = new Set(["business", "welfare", "office"]);

async function syncOrderCosts(client: PoolClient, orderId: string) {
  await client.query(
    `UPDATE orders
        SET custom_product_cost = (SELECT COALESCE(sum(amount_cny) FILTER(WHERE category IN ('goods','sourcing','accessory','certificate','box','other')), 0) FROM order_expenses WHERE order_id = $1 AND voided_at IS NULL),
            labor_cost = (SELECT COALESCE(sum(amount_cny) FILTER(WHERE category IN ('labor','design')), 0) FROM order_expenses WHERE order_id = $1 AND voided_at IS NULL),
            shipping_cost = (SELECT COALESCE(sum(amount_cny) FILTER(WHERE category = 'shipping'), 0) FROM order_expenses WHERE order_id = $1 AND voided_at IS NULL),
            updated_at = now()
      WHERE id = $1`,
    [orderId]
  );
}

async function postReimbursementExpense(
  client: PoolClient,
  claim: { id: string; order_id: string; expense_date: string; amount_cny: string; purpose: string; claimant: string },
  actorId: string
) {
  const expenseId = randomUUID();
  const label = `报销垫付 · ${claim.purpose}`.slice(0, 120);
  const hash = createHash("sha256")
    .update(JSON.stringify({ claimId: claim.id, orderId: claim.order_id, amount: claim.amount_cny }))
    .digest("hex");
  await client.query(
    `INSERT INTO order_expenses(id, order_id, business_date, category, label, amount_cny, created_by, request_key, payload_hash, counterparty, note, payment_tracking_started)
     VALUES ($1, $2, $3, 'accessory', $4, $5, $6, $7, $8, $9, $10, FALSE)`,
    [expenseId, claim.order_id, claim.expense_date, label, claim.amount_cny, actorId, randomUUID(), hash, claim.claimant, `来自垫付报销单 ${claim.id}`]
  );
  await syncOrderCosts(client, claim.order_id);
  return expenseId;
}

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

  router.get("/reimbursements/proofs/:proofId", async (req, res, next) => {
    try {
      const actor = reimbursementActor(req.actor);
      const { where, args } = claimScope(actor, await managedTeamIds(db, actor));
      const proof = (await db.query(
        `SELECT p.mime_type,p.image_bytes FROM reimbursement_proofs p
           JOIN reimbursement_claims c ON c.id=p.claim_id WHERE ${where} AND p.id=$${args.length+1}`,
        [...args, uuid(req.params.proofId)]
      )).rows[0];
      if (!proof) throw new HttpError(404,"凭证不存在");
      res.set({ "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff" })
        .type(proof.mime_type).send(proof.image_bytes);
    } catch (error) { next(error); }
  });

  const parseProofs = json({ limit: "21mb" });
  router.all("/reimbursements", (req,res,next) => {
    try {
      reimbursementActor(req.actor);
      if (req.method === "POST") parseProofs(req,res,next);
      else next();
    } catch (error) { next(error); }
  }, async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "POST") { next(); return; }
    const client = await db.connect();
    try {
      const actor = reimbursementActor(req.actor);
      const today = businessToday(new Date(), config.businessTimezone);
      await client.query("BEGIN");
      const scope = await managedTeamIds(client, actor);
      if (req.method === "POST") await applyReimbursement(client, req.body ?? {}, { actor, scope, actorId: actor.id, today, ip: req.ip });
      const payload = await reimbursementSnapshot(client, actor, scope, today);
      await client.query("COMMIT");
      res.set("Cache-Control", "private, no-store").json(payload);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally { client.release(); }
  });

  return router;
}

async function staffTeamsOnDate(client: PoolClient, userId: string, date: string) {
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT t.id::text AS id, t.name
       FROM team_memberships m
       JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = $1
        AND m.start_date <= $2::date
        AND (m.end_date IS NULL OR m.end_date >= $2::date)
        AND t.is_active
      ORDER BY ${teamOrderSql("t")}`,
    [userId, date]
  );
  return [...new Map(rows.map((team) => [team.id, team])).values()];
}

async function allActiveTeams(client: PoolClient) {
  return (await client.query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM teams WHERE is_active ORDER BY ${teamOrderSql("teams")}`
  )).rows;
}

async function scopedActiveTeams(client: PoolClient, scope: string[]) {
  if (!scope.length) return [];
  return (await client.query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM teams WHERE is_active AND id = ANY($1::uuid[]) ORDER BY ${teamOrderSql("teams")}`,
    [scope]
  )).rows;
}

async function reimbursementSnapshot(client: PoolClient, actor: Actor, scope: string[], today: string) {
  const { where, args } = claimScope(actor, scope);
  const claims = (await client.query(
    `SELECT c.id::text AS id, c.claimant, c.department, c.category,
            c.claim_type AS "claimType",
            c.welfare_customer AS "welfareCustomer",
            COALESCE(c.posted_expense_id::text, '') AS "postedExpenseId",
            c.purpose, c.amount_cny::text AS amount,
            c.expense_date::text AS "expenseDate", c.claim_date::text AS "claimDate",
            COALESCE(c.expense_id::text, '') AS "expenseId", c.receipt_ref AS "receiptRef", c.note, c.status, c.version,
            c.created_by::text AS "createdById",
            u.display_name AS "createdBy", c.review_note AS "reviewNote", reviewer.display_name AS "reviewedBy",
            c.workflow_stage AS stage,c.supervisor_note AS "supervisorNote", supervisor.display_name AS "forwardedBy",
            COALESCE(c.team_id::text, '') AS "teamId",
            COALESCE(c.order_id::text, '') AS "orderId",
            COALESCE(o.order_ref, '') AS "orderRef",
            COALESCE(o.customer_label, '') AS "customerLabel",
            COALESCE(o.business_date::text, '') AS "orderDate",
            coalesce((SELECT sum(p.amount_cny) FROM reimbursement_payments p WHERE p.claim_id=c.id),0)::text AS "paidAmount",
            ARRAY(SELECT id FROM reimbursement_proofs WHERE claim_id=c.id ORDER BY position) AS "proofIds"
       FROM reimbursement_claims c JOIN users u ON c.created_by=u.id
       LEFT JOIN users reviewer ON c.reviewed_by=reviewer.id
       LEFT JOIN users supervisor ON c.forwarded_by=supervisor.id
       LEFT JOIN orders o ON c.order_id = o.id
      WHERE ${where}
      ORDER BY c.created_at, c.id`, args
  )).rows;
  const teams = actor.role === "cs"
    ? await staffTeamsOnDate(client, actor.id, today)
    : actor.role === "cs_supervisor"
      ? await scopedActiveTeams(client, scope)
      : await allActiveTeams(client);
  const orders = actor.role === "cs"
    ? (await client.query(
      `SELECT o.id::text AS id,
              o.order_ref AS "orderRef",
              COALESCE(o.customer_label, '') AS "customerLabel",
              o.business_date::text AS "businessDate",
              o.amount::text AS amount,
              o.user_id::text AS "userId",
              COALESCE(o.performance_team_id::text, mem.team_id::text, '') AS "teamId",
              COALESCE(t.name, '') AS "teamName"
         FROM orders o
         LEFT JOIN LATERAL (
           SELECT m.team_id FROM team_memberships m
            WHERE m.user_id = o.user_id AND m.start_date <= o.business_date
              AND (m.end_date IS NULL OR m.end_date >= o.business_date)
            ORDER BY m.start_date DESC LIMIT 1
         ) mem ON TRUE
         LEFT JOIN teams t ON t.id = COALESCE(o.performance_team_id, mem.team_id)
        WHERE o.user_id = $1
        ORDER BY o.business_date DESC, o.created_at DESC
        LIMIT 200`,
      [actor.id]
    )).rows
    : actor.role === "cs_supervisor"
      ? (scope.length ? (await client.query(
        `SELECT o.id::text AS id,
                o.order_ref AS "orderRef",
                COALESCE(o.customer_label, '') AS "customerLabel",
                o.business_date::text AS "businessDate",
                o.amount::text AS amount,
                o.user_id::text AS "userId",
                COALESCE(o.performance_team_id::text, mem.team_id::text, '') AS "teamId",
                COALESCE(t.name, '') AS "teamName"
           FROM orders o
           LEFT JOIN LATERAL (
             SELECT m.team_id FROM team_memberships m
              WHERE m.user_id = o.user_id AND m.start_date <= o.business_date
                AND (m.end_date IS NULL OR m.end_date >= o.business_date)
              ORDER BY m.start_date DESC LIMIT 1
           ) mem ON TRUE
           LEFT JOIN teams t ON t.id = COALESCE(o.performance_team_id, mem.team_id)
          WHERE COALESCE(o.performance_team_id, mem.team_id) = ANY($1::uuid[])
          ORDER BY o.business_date DESC, o.created_at DESC
          LIMIT 200`,
        [scope]
      )).rows : [])
      : (await client.query(
        `SELECT o.id::text AS id,
                o.order_ref AS "orderRef",
                COALESCE(o.customer_label, '') AS "customerLabel",
                o.business_date::text AS "businessDate",
                o.amount::text AS amount,
                o.user_id::text AS "userId",
                COALESCE(o.performance_team_id::text, mem.team_id::text, '') AS "teamId",
                COALESCE(t.name, '') AS "teamName"
           FROM orders o
           LEFT JOIN LATERAL (
             SELECT m.team_id FROM team_memberships m
              WHERE m.user_id = o.user_id AND m.start_date <= o.business_date
                AND (m.end_date IS NULL OR m.end_date >= o.business_date)
              ORDER BY m.start_date DESC LIMIT 1
           ) mem ON TRUE
           LEFT JOIN teams t ON t.id = COALESCE(o.performance_team_id, mem.team_id)
          ORDER BY o.business_date DESC, o.created_at DESC
          LIMIT 200`
      )).rows;
  if (actor.role !== "finance") return { state: { claims, payments: [] }, categories: CLAIM_CATEGORIES, expenses: [], teams, orders };
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
  return { state: { claims, payments }, categories: CLAIM_CATEGORIES, expenses, teams, orders };
}

async function applyReimbursement(client: PoolClient, input: Record<string, unknown>, ctx: { actor: Actor; scope: string[]; actorId: string; today: string; ip?: string }) {
  if (input.action === "create") {
    if (ctx.actor.role === "cs_supervisor") throw new HttpError(403,"请由客服发起报销");
    const staff = ctx.actor.role === "cs";
    const requestKey = uuid(input.requestKey);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["reimbursement:"+requestKey]);
    const existing = (await client.query("SELECT created_by FROM reimbursement_claims WHERE request_key=$1", [requestKey])).rows[0];
    if (existing) {
      if (existing.created_by !== ctx.actorId) throw new HttpError(409,"提交编号已被使用");
      return;
    }
    if (!Array.isArray(input.proofs) || input.proofs.length < 1 || input.proofs.length > 3) {
      throw new HttpError(400,"请上传 1 至 3 张付款截图或账单截图");
    }
    const proofs = input.proofs.map(readProof);
    let team: { id: string; name: string } | undefined;
    if (staff) {
      const memberTeams = await staffTeamsOnDate(client, ctx.actorId, ctx.today);
      if (!memberTeams.length) throw new HttpError(409, "当前客服账号未分配小组，请联系管理员");
      const requestedTeamId = typeof input.teamId === "string" && input.teamId.trim() ? uuid(input.teamId) : "";
      if (requestedTeamId) {
        team = memberTeams.find((item) => item.id === requestedTeamId);
        if (!team) throw new HttpError(400, "请选择当前客服所属的小组");
      } else if (memberTeams.length === 1) {
        team = memberTeams[0];
      } else {
        throw new HttpError(400, "请选择本次报销所属客服组别");
      }
    } else if (typeof input.teamId === "string" && input.teamId.trim()) {
      const activeTeams = await allActiveTeams(client);
      team = activeTeams.find((item) => item.id === uuid(input.teamId));
      if (!team) throw new HttpError(400, "所选客服组别无效");
    }
    const rawType = typeof input.claimType === "string" && input.claimType.trim()
      ? input.claimType.trim()
      : (typeof input.orderId === "string" && input.orderId.trim()) || (typeof input.expenseId === "string" && input.expenseId.trim())
        ? "business"
        : "office";
    if (!CLAIM_TYPES.has(rawType)) throw new HttpError(400, "报销分类无效");
    const claimType = rawType as "business" | "welfare" | "office";
    const welfareCustomer = claimType === "welfare" && typeof input.welfareCustomer === "string"
      ? input.welfareCustomer.trim().slice(0, 128)
      : "";
    if (!staff && !Object.hasOwn(CLAIM_CATEGORIES, String(input.category))) throw new HttpError(400, "报销类别无效");
    const amount = parseMoney(input.amount, "报销金额");
    if (moneyToCents(amount) <= 0n) throw new HttpError(400, "报销金额必须大于0");
    const expenseId = !staff && claimType === "business" && typeof input.expenseId === "string" && input.expenseId ? input.expenseId : null;
    let orderId: string | null = null;
    if (expenseId) {
      const pending = await pendingExpense(client, expenseId);
      if (moneyToCents(amount) > pending) throw new HttpError(400, "报销金额超过关联费用待付金额");
      const duplicate = await client.query("SELECT 1 FROM reimbursement_claims WHERE expense_id = $1 AND status <> 'rejected'", [expenseId]);
      if (duplicate.rowCount) throw new HttpError(409, "该费用已有报销单，请勿重复登记");
      const linkedOrder = (await client.query<{ order_id: string }>("SELECT order_id::text FROM order_expenses WHERE id = $1", [expenseId])).rows[0];
      orderId = linkedOrder?.order_id ?? null;
    } else if (claimType === "business") {
      const rawOrderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
      if (!rawOrderId) throw new HttpError(400, "业务类报销请选择关联订单；未开单客户请选择「未开单福利品」");
      const candidateOrderId = uuid(rawOrderId);
      const owned = staff
        ? (await client.query("SELECT id FROM orders WHERE id = $1 AND user_id = $2", [candidateOrderId, ctx.actorId])).rows[0]
        : (await client.query("SELECT id FROM orders WHERE id = $1", [candidateOrderId])).rows[0];
      if (!owned) throw new HttpError(400, staff ? "所选订单不存在或不属于当前客服" : "所选订单不存在");
      orderId = candidateOrderId;
    }
    const claimant = staff ? ctx.actor.displayName : text(input.claimant, "报销人", 128);
    const receipt = "image:" + createHash("sha256").update(proofs[0].bytes).digest("hex");
    const duplicateReceipt = await client.query("SELECT 1 FROM reimbursement_claims WHERE status <> 'rejected' AND claimant = $1 AND receipt_ref = $2", [claimant, receipt]);
    if (duplicateReceipt.rowCount) throw new HttpError(409, "该报销人与凭证已有报销单，请核对");
    const expenseDate = dateOnOrBefore(input.expenseDate, ctx.today, "费用日期");
    const claimDate = staff ? ctx.today : dateOnOrBefore(input.claimDate, ctx.today, "报销登记日期");
    if (expenseDate > claimDate) throw new HttpError(400, "费用日期不能晚于报销登记日期");
    const department = team ? team.name : typeof input.department === "string" ? input.department.trim().slice(0, 64) : "";
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
    const saved = (await client.query(
      `INSERT INTO reimbursement_claims
        (request_key, claimant, department, category, claim_type, welfare_customer, purpose, amount_cny, expense_date, claim_date, expense_id, receipt_ref, note, status, created_by, workflow_stage, team_id, order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15,$16,$17)
       RETURNING id`,
      [requestKey, claimant, department, staff ? (claimType === "office" ? "other" : "advance") : input.category, claimType, welfareCustomer, text(input.purpose, "报销事由", 500), amount, expenseDate, claimDate, expenseId, receipt, note, ctx.actorId, staff ? "supervisor" : "finance", team?.id ?? null, orderId]
    )).rows[0];
    for (const [position,proof] of proofs.entries()) {
      await client.query("INSERT INTO reimbursement_proofs(claim_id,position,mime_type,image_bytes) VALUES($1,$2,$3,$4)",
        [saved.id,position,proof.mime,proof.bytes]);
    }
    await writeAudit(client, { actorId: ctx.actorId, action: "reimbursement_create", entityType: "reimbursement_claim", entityId: saved.id, after: { proofCount: proofs.length, stage: staff ? "supervisor" : "finance", claimType, welfareCustomer, teamId: team?.id ?? null, orderId }, ip: ctx.ip });
    return;
  }

  const id = uuid(input.id);
  const claim = (await client.query<{ id: string; status: string; version: number; amount_cny: string; expense_id: string | null; posted_expense_id: string | null; claim_type: string; order_id: string | null; purpose: string; expense_date: string; claimant: string; department: string; team_id: string | null; workflow_stage: string; created_by: string }>(
    `SELECT id::text, status, version, amount_cny::text, expense_id::text, posted_expense_id::text, claim_type, order_id::text, purpose, expense_date::text, claimant, department, team_id::text, workflow_stage, created_by::text
       FROM reimbursement_claims WHERE id = $1 FOR UPDATE`,
    [id]
  )).rows[0];
  if (
    !claim ||
    (ctx.actor.role === "cs_supervisor" && (!claim.team_id || !ctx.scope.includes(claim.team_id))) ||
    (ctx.actor.role === "cs" && claim.created_by !== ctx.actorId)
  ) {
    throw new HttpError(404, "报销单不存在");
  }
  if (Number(input.version) !== claim.version) throw new HttpError(409, "报销单已更新，请刷新后重试");

  if (input.action === "updateTeam") {
    if (ctx.actor.role === "cs" && !["supervisor", "supervisor_returned"].includes(claim.workflow_stage)) {
      throw new HttpError(409, "该报销单已提交财务，不能由客服修改组别");
    }
    const allowedTeams = ctx.actor.role === "cs"
      ? await staffTeamsOnDate(client, ctx.actorId, ctx.today)
      : ctx.actor.role === "cs_supervisor"
        ? await scopedActiveTeams(client, ctx.scope)
        : await allActiveTeams(client);
    const nextTeamId = uuid(input.teamId);
    const nextTeam = allowedTeams.find((item) => item.id === nextTeamId);
    if (!nextTeam) throw new HttpError(400, "所选客服组别无效或无权限");
    await client.query(
      "UPDATE reimbursement_claims SET team_id = $2, department = $3, version = version + 1 WHERE id = $1",
      [claim.id, nextTeam.id, nextTeam.name]
    );
    await writeAudit(client, {
      actorId: ctx.actorId,
      action: "reimbursement_update_team",
      entityType: "reimbursement_claim",
      entityId: claim.id,
      before: { teamId: claim.team_id, department: claim.department },
      after: { teamId: nextTeam.id, department: nextTeam.name },
      ip: ctx.ip
    });
    return;
  }

  if (input.action === "bindOrder") {
    if (claim.claim_type !== "welfare" || claim.order_id) {
      throw new HttpError(409, "仅未关联订单的福利品报销可转绑新订单");
    }
    if (claim.status === "rejected" || claim.status === "historical") {
      throw new HttpError(409, "已退回或历史报销单不可转绑订单");
    }
    const targetOrderId = uuid(input.orderId);
    const orderCheck = ctx.actor.role === "cs"
      ? await client.query("SELECT id FROM orders WHERE id = $1 AND user_id = $2", [targetOrderId, ctx.actorId])
      : ctx.actor.role === "cs_supervisor"
        ? await client.query(
          `SELECT o.id FROM orders o
             LEFT JOIN LATERAL (
               SELECT m.team_id FROM team_memberships m
                WHERE m.user_id = o.user_id AND m.start_date <= o.business_date
                  AND (m.end_date IS NULL OR m.end_date >= o.business_date)
                ORDER BY m.start_date DESC LIMIT 1
             ) mem ON TRUE
            WHERE o.id = $1 AND COALESCE(o.performance_team_id, mem.team_id) = ANY($2::uuid[])`,
          [targetOrderId, ctx.scope]
        )
        : await client.query("SELECT id FROM orders WHERE id = $1", [targetOrderId]);
    if (!orderCheck.rowCount) throw new HttpError(400, "所选订单不存在或无权绑定");
    let postedExpenseId = claim.posted_expense_id;
    if (claim.status === "approved" && !claim.expense_id && !postedExpenseId) {
      postedExpenseId = await postReimbursementExpense(client, { ...claim, order_id: targetOrderId }, ctx.actorId);
    }
    await client.query(
      "UPDATE reimbursement_claims SET claim_type = 'business', order_id = $2, posted_expense_id = $3, version = version + 1 WHERE id = $1",
      [claim.id, targetOrderId, postedExpenseId]
    );
    await writeAudit(client, {
      actorId: ctx.actorId,
      action: "reimbursement_bind_order",
      entityType: "reimbursement_claim",
      entityId: claim.id,
      before: { claimType: claim.claim_type, orderId: null },
      after: { claimType: "business", orderId: targetOrderId, postedExpenseId },
      ip: ctx.ip
    });
    return;
  }

  if (ctx.actor.role === "cs") throw new HttpError(403,"客服只能发起报销或修改待审组别");
  if (ctx.actor.role === "cs_supervisor") {
    const forward = input.action === "forward";
    const returned = input.action === "supervisorReturn";
    if (!forward && !returned) throw new HttpError(403,"主管仅可提交财务或退回客服");
    if (claim.workflow_stage !== "supervisor") throw new HttpError(409,"凭证不存在?");
    const reason = returned ? text(input.reason,"主管仅可提交财务或退回客服",500) : null;
    await client.query(
      `UPDATE reimbursement_claims SET workflow_stage=$2,status=$3,supervisor_note=$4,
          forwarded_by=$5,forwarded_at=CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END,version=version+1 WHERE id=$1`,
      [id,forward ? "finance" : "supervisor_returned",forward ? "pending" : "rejected",reason,forward ? ctx.actorId : null]
    );
    await writeAudit(client,{actorId:ctx.actorId,action:forward ? "reimbursement_forward" : "reimbursement_supervisor_return",entityType:"reimbursement_claim",entityId:id,after:{reason},ip:ctx.ip});
    return;
  }
  if (claim.workflow_stage !== "finance") throw new HttpError(409,"该记录尚未进入财务报销流程");

  if (input.action === "review") {
    if (claim.status !== "pending") throw new HttpError(409, "该报销单已处理");
    if (input.decision !== "approved" && input.decision !== "rejected") throw new HttpError(400, "核对结果无效");
    const reason = text(input.reason, "核对说明", 500);
    if (input.decision === "approved" && claim.expense_id) {
      const pending = await pendingExpense(client, claim.expense_id);
      if (moneyToCents(claim.amount_cny) > pending) throw new HttpError(409, "关联费用待付余额已变化，请核对");
    }
    let postedExpenseId = claim.posted_expense_id;
    if (input.decision === "approved" && claim.claim_type === "business" && claim.order_id && !claim.expense_id && !postedExpenseId) {
      postedExpenseId = await postReimbursementExpense(client, { ...claim, order_id: claim.order_id }, ctx.actorId);
    }
    await client.query(
      `UPDATE reimbursement_claims
          SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), posted_expense_id = $5, version = version + 1
        WHERE id = $1`,
      [claim.id, input.decision, reason, ctx.actorId, postedExpenseId]
    );
    await writeAudit(client, { actorId: ctx.actorId, action: "reimbursement_review", entityType: "reimbursement_claim", entityId: claim.id, after: { decision: input.decision, reason, postedExpenseId }, ip: ctx.ip });
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
