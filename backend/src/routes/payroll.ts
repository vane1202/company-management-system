import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../audit.js";
import { toDateOnly } from "../lib/dates.js";
import { addMoney, formatMoney, parseMoney } from "../lib/money.js";
import { allocateSalaries } from "../lib/salary.js";
import { hashPayload, textField, uuid } from "../lib/commerce.js";
import { monthBounds, parsePayMonth, parsePayrollKind, payslipTotals, type PayrollKind } from "../lib/payroll.js";
import { HttpError } from "../types.js";

type Row = Record<string, any>;
const NOTE = "实发 = 底薪 + 提成 + 奖金 − 扣款，人民币精确到分，不四舍五入到元。底薪沿用工资标准按自然月天数分摊；提成、奖金、扣款全部由财务逐条手工录入，系统不自动计算比例、个税或社保。本页是核算记录，不代表已付款。";

/**
 * 月度工资单。挂载在 /api/salaries/payroll 下，继承工资路由的角色检查：
 * 财务读写、BOSS 只读，其余角色 403。
 */
export function createPayrollRouter(db: Pool): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const month = parsePayMonth(req.query.month);
      const userId = req.query.userId ? uuid(req.query.userId) : "";
      res.json(await buildPayroll(db, month, userId));
    } catch (e) { next(e); }
  });

  router.get("/items", async (req, res, next) => {
    try {
      const month = parsePayMonth(req.query.month);
      const userId = req.query.userId ? uuid(req.query.userId) : "";
      const rows = (await db.query(`${ITEM_SELECT} WHERE i.pay_month=$1 AND ($2='' OR i.user_id::text=$2) ORDER BY i.created_at,i.id`, [month, userId])).rows;
      res.json({ items: rows.map(serializeItem) });
    } catch (e) { next(e); }
  });

  router.get("/items/:id/history", async (req, res, next) => {
    try {
      const id = uuid(req.params.id);
      if (!(await db.query("SELECT 1 FROM payroll_items WHERE id=$1", [id])).rowCount) throw new HttpError(404, "工资项目不存在");
      const rows = (await db.query(`SELECT a.id,a.action,a.before_data,a.after_data,a.created_at,u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='payroll_item' AND a.entity_id=$1 ORDER BY a.created_at DESC,a.id DESC`, [id])).rows;
      res.json({ history: rows.map(row => ({ id: row.id, action: row.action, before: row.before_data, after: row.after_data, createdAt: row.created_at, actorName: row.actor_name ?? "历史操作人" })) });
    } catch (e) { next(e); }
  });

  router.post("/items", tx(db, async (client, req) => {
    const userId = uuid(req.body?.userId), input = readItem(req.body), requestKey = uuid(req.body?.requestKey);
    await employeeLock(client, userId);
    const hash = hashPayload({ userId, ...input });
    const existing = (await client.query(`${ITEM_SELECT} WHERE i.request_key=$1`, [requestKey])).rows[0];
    if (existing) {
      if (existing.payload_hash !== hash || existing.corrects_id) throw new HttpError(409, "提交标识已用于另一份内容，请刷新后重试");
      return { status: 200, body: { item: serializeItem(existing), replayed: true } };
    }
    await assertDraft(client, userId, input.month);
    const saved = (await client.query(`INSERT INTO payroll_items(user_id,pay_month,kind,amount,note,request_key,payload_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [userId, input.month, input.kind, input.amount, input.note, requestKey, hash, req.actor!.id])).rows[0];
    const item = await loadItem(client, saved.id);
    await writeAudit(client, { actorId: req.actor!.id, action: "payroll_item_create", entityType: "payroll_item", entityId: saved.id, after: auditItem(item), ip: req.ip });
    return { status: 201, body: { item: serializeItem(item) } };
  }));

  router.post("/items/:id/void", tx(db, async (client, req) => {
    const id = uuid(req.params.id), reason = textField(req.body?.reason, "作废原因", 500);
    const before = await lockActiveItem(client, id, req.body?.version);
    await voidItem(client, before, reason, req.actor!.id);
    const after = await loadItem(client, id);
    await writeAudit(client, { actorId: req.actor!.id, action: "payroll_item_void", entityType: "payroll_item", entityId: id, before: auditItem(before), after: { ...auditItem(after), reason }, ip: req.ip });
    return { status: 200, body: { item: serializeItem(after) } };
  }));

  // 更正 = 作废原项目 + 新增一条更正项目（同员工、同月份），同一事务完成并分别留痕。
  router.post("/items/:id/correct", tx(db, async (client, req) => {
    const id = uuid(req.params.id), reason = textField(req.body?.reason, "更正原因", 500), requestKey = uuid(req.body?.requestKey);
    const target = (await client.query("SELECT user_id,pay_month FROM payroll_items WHERE id=$1", [id])).rows[0];
    if (!target) throw new HttpError(404, "工资项目不存在");
    const input = readItem({ ...req.body, month: target.pay_month });
    const hash = hashPayload({ correct: id, userId: target.user_id, ...input });
    await employeeLock(client, target.user_id);
    const replay = (await client.query(`${ITEM_SELECT} WHERE i.request_key=$1`, [requestKey])).rows[0];
    if (replay) {
      if (replay.payload_hash !== hash) throw new HttpError(409, "提交标识已用于另一份内容，请刷新后重试");
      return { status: 200, body: { item: serializeItem(replay), voided: serializeItem(await loadItem(client, id)), replayed: true } };
    }
    const before = await lockActiveItem(client, id, req.body?.version, true);
    await voidItem(client, before, reason, req.actor!.id);
    const saved = (await client.query(`INSERT INTO payroll_items(user_id,pay_month,kind,amount,note,request_key,payload_hash,created_by,corrects_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [before.user_id, before.pay_month, input.kind, input.amount, input.note, requestKey, hash, req.actor!.id, id])).rows[0];
    const voided = await loadItem(client, id), created = await loadItem(client, saved.id);
    await writeAudit(client, { actorId: req.actor!.id, action: "payroll_item_void", entityType: "payroll_item", entityId: id, before: auditItem(before), after: { ...auditItem(voided), reason, correctedBy: saved.id }, ip: req.ip });
    await writeAudit(client, { actorId: req.actor!.id, action: "payroll_item_correct", entityType: "payroll_item", entityId: saved.id, before: auditItem(before), after: { ...auditItem(created), reason, corrects: id }, ip: req.ip });
    return { status: 201, body: { item: serializeItem(created), voided: serializeItem(voided) } };
  }));

  router.post("/months/lock", tx(db, async (client, req) => {
    const userId = uuid(req.body?.userId), month = parsePayMonth(req.body?.month);
    await employeeLock(client, userId);
    const current = await monthRow(client, userId, month);
    checkVersion(current, req.body?.version);
    if (current?.status === "locked") throw new HttpError(409, "该员工本月工资单已锁定");
    const live = await computeLive(client, userId, month);
    const saved = (await client.query(`INSERT INTO payroll_months(user_id,pay_month,status,locked_base,locked_commission,locked_bonus,locked_deduction,locked_net,locked_at,locked_by,updated_by)
      VALUES($1,$2,'locked',$3,$4,$5,$6,$7,now(),$8,$8)
      ON CONFLICT (user_id,pay_month) DO UPDATE SET status='locked',version=payroll_months.version+1,locked_base=$3,locked_commission=$4,locked_bonus=$5,locked_deduction=$6,locked_net=$7,locked_at=now(),locked_by=$8,updated_by=$8,updated_at=now()
      RETURNING *`, [userId, month, live.base, live.commission, live.bonus, live.deduction, live.net, req.actor!.id])).rows[0];
    await writeAudit(client, { actorId: req.actor!.id, action: "payroll_month_lock", entityType: "payroll_month", entityId: `${userId}:${month}`, before: current ? { status: current.status, version: current.version } : { status: "draft", version: 0 }, after: { status: "locked", version: saved.version, ...live }, ip: req.ip });
    return { status: 200, body: { month: serializeMonth(saved) } };
  }));

  router.post("/months/unlock", tx(db, async (client, req) => {
    const userId = uuid(req.body?.userId), month = parsePayMonth(req.body?.month), reason = textField(req.body?.reason, "解锁原因", 500);
    await employeeLock(client, userId);
    const current = await monthRow(client, userId, month);
    checkVersion(current, req.body?.version);
    if (current?.status !== "locked") throw new HttpError(409, "该员工本月工资单未锁定");
    const saved = (await client.query(`UPDATE payroll_months SET status='draft',version=version+1,locked_base=NULL,locked_commission=NULL,locked_bonus=NULL,locked_deduction=NULL,locked_net=NULL,locked_at=NULL,locked_by=NULL,updated_by=$3,updated_at=now() WHERE user_id=$1 AND pay_month=$2 RETURNING *`, [userId, month, req.actor!.id])).rows[0];
    await writeAudit(client, { actorId: req.actor!.id, action: "payroll_month_unlock", entityType: "payroll_month", entityId: `${userId}:${month}`, before: { ...serializeMonth(current) }, after: { status: "draft", version: saved.version, reason }, ip: req.ip });
    return { status: 200, body: { month: serializeMonth(saved) } };
  }));

  router.get("/months/history", async (req, res, next) => {
    try {
      const userId = uuid(req.query.userId), month = parsePayMonth(req.query.month);
      const rows = (await db.query(`SELECT a.id,a.action,a.before_data,a.after_data,a.created_at,u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='payroll_month' AND a.entity_id=$1 ORDER BY a.created_at DESC,a.id DESC`, [`${userId}:${month}`])).rows;
      res.json({ history: rows.map(row => ({ id: row.id, action: row.action, before: row.before_data, after: row.after_data, createdAt: row.created_at, actorName: row.actor_name ?? "历史操作人" })) });
    } catch (e) { next(e); }
  });

  return router;
}

const ITEM_SELECT = `SELECT i.*,cu.display_name AS created_by_name,vu.display_name AS voided_by_name,
  (SELECT r.id FROM payroll_items r WHERE r.corrects_id=i.id) AS corrected_by
  FROM payroll_items i LEFT JOIN users cu ON cu.id=i.created_by LEFT JOIN users vu ON vu.id=i.voided_by`;

type TxResult = { status: number; body: unknown };
function tx(db: Pool, handler: (client: PoolClient, req: Request) => Promise<TxResult>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const result = await handler(client, req);
        await client.query("COMMIT");
        res.status(result.status).json(result.body);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (typeof e === "object" && e && "code" in e && e.code === "23505") next(new HttpError(409, "记录已被并发修改或重复提交，请刷新后重试"));
        else next(e);
      } finally { client.release(); }
    })();
  };
}

async function employeeLock(client: PoolClient, id: string) {
  const employee = (await client.query("SELECT id,account_kind FROM users WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!employee || employee.account_kind !== "employee") throw new HttpError(400, "工资只能关联员工，不能关联客服接待账号");
}

async function monthRow(client: PoolClient | Pool, userId: string, month: string): Promise<Row | undefined> {
  return (await client.query("SELECT * FROM payroll_months WHERE user_id=$1 AND pay_month=$2", [userId, month])).rows[0];
}

async function assertDraft(client: PoolClient, userId: string, month: string) {
  const row = await monthRow(client, userId, month);
  if (row?.status === "locked") throw new HttpError(409, "该员工本月工资单已锁定，需先由财务解锁才能修改项目");
}

function checkVersion(row: Row | undefined, input: unknown) {
  const expected = row ? Number(row.version) : 0;
  if (input === undefined || input === null || Number(input) !== expected) throw new HttpError(409, "工资单状态已变更，请刷新后再操作");
}

async function lockActiveItem(client: PoolClient, id: string, version: unknown, alreadyLockedEmployee = false): Promise<Row> {
  const target = (await client.query("SELECT user_id FROM payroll_items WHERE id=$1", [id])).rows[0];
  if (!target) throw new HttpError(404, "工资项目不存在");
  if (!alreadyLockedEmployee) await employeeLock(client, target.user_id);
  const before = (await client.query(`${ITEM_SELECT} WHERE i.id=$1 FOR UPDATE OF i`, [id])).rows[0];
  if (before.voided_at) throw new HttpError(409, "该项目已作废，不能再次修改");
  if (version === undefined || Number(version) !== Number(before.version)) throw new HttpError(409, "工资项目已变更，请刷新后再操作");
  await assertDraft(client, before.user_id, before.pay_month);
  return before;
}

async function voidItem(client: PoolClient, item: Row, reason: string, actorId: string) {
  await client.query("UPDATE payroll_items SET voided_at=now(),voided_by=$2,void_reason=$3,version=version+1 WHERE id=$1", [item.id, actorId, reason]);
}

async function loadItem(client: PoolClient, id: string): Promise<Row> {
  return (await client.query(`${ITEM_SELECT} WHERE i.id=$1`, [id])).rows[0];
}

function readItem(body: Record<string, unknown> = {}) {
  return {
    month: parsePayMonth(body.month),
    kind: parsePayrollKind(body.kind),
    amount: positive(parseMoney(body.amount, "金额")),
    note: textField(body.note, "备注", 500)
  };
}
function positive(value: string) {
  if (/^0(\.0{1,2})?$/.test(value)) throw new HttpError(400, "金额须大于 0；扣款请选择“扣款”类型并填写正数");
  return value;
}

function serializeItem(row: Row) {
  return {
    id: row.id, userId: row.user_id, month: row.pay_month, kind: row.kind as PayrollKind, amount: formatMoney(row.amount), note: row.note,
    version: Number(row.version), createdAt: row.created_at, createdByName: row.created_by_name ?? "历史操作人",
    voided: !!row.voided_at, voidedAt: row.voided_at ?? null, voidReason: row.void_reason ?? null, voidedByName: row.voided_by_name ?? null,
    correctsId: row.corrects_id ?? null, correctedById: row.corrected_by ?? null
  };
}
function auditItem(row: Row) {
  return { userId: row.user_id, month: row.pay_month, kind: row.kind, amount: formatMoney(row.amount), note: row.note, version: Number(row.version), voided: !!row.voided_at };
}
function serializeMonth(row: Row | undefined) {
  if (!row) return { status: "draft", version: 0, lockedAt: null, lockedSnapshot: null };
  return {
    status: row.status as "draft" | "locked", version: Number(row.version), lockedAt: row.locked_at ?? null,
    lockedSnapshot: row.status === "locked" ? { base: formatMoney(row.locked_base), commission: formatMoney(row.locked_commission), bonus: formatMoney(row.locked_bonus), deduction: formatMoney(row.locked_deduction), net: formatMoney(row.locked_net) } : null
  };
}

async function computeLive(client: PoolClient | Pool, userId: string, month: string) {
  const { from, to } = monthBounds(month);
  const salaries = (await client.query("SELECT monthly_amount::text,effective_from::text,effective_to::text FROM salaries WHERE user_id=$1 AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>=$2)", [userId, from, to])).rows;
  const items = (await client.query("SELECT kind,amount::text FROM payroll_items WHERE user_id=$1 AND pay_month=$2 AND voided_at IS NULL", [userId, month])).rows;
  return payslipTotals(allocateSalaries(salaries, from, to), items);
}

type Totals = { base: string; commission: string; bonus: string; deduction: string; net: string };
function sumTotals(rows: Totals[]) {
  const pick = (key: keyof Totals) => addMoney(rows.map(row => row[key]));
  const net = pick("net");
  return { base: pick("base"), commission: pick("commission"), bonus: pick("bonus"), deduction: pick("deduction"), net, netNegative: net.startsWith("-") };
}

export async function buildPayroll(db: Pool, month: string, userId: string) {
  const { from, to } = monthBounds(month);
  const people = (await db.query(`SELECT u.id,u.display_name,u.username,u.role,u.is_active FROM users u
    WHERE u.account_kind='employee' AND ($3='' OR u.id::text=$3) AND (
      ($3<>'' AND u.id::text=$3)
      OR EXISTS(SELECT 1 FROM salaries s WHERE s.user_id=u.id AND s.effective_from<=$2 AND (s.effective_to IS NULL OR s.effective_to>=$1))
      OR EXISTS(SELECT 1 FROM payroll_items i WHERE i.user_id=u.id AND i.pay_month=$4)
      OR EXISTS(SELECT 1 FROM payroll_months m WHERE m.user_id=u.id AND m.pay_month=$4))
    ORDER BY u.display_name,u.id`, [from, to, userId, month])).rows;
  if (userId && !people.length) throw new HttpError(404, "员工不存在或不是领薪员工");
  const ids = people.map(p => p.id);
  const salaryRows = ids.length ? (await db.query(`SELECT id,user_id,monthly_amount::text,effective_from::text,effective_to::text FROM salaries WHERE user_id=ANY($1::uuid[]) AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>=$2) ORDER BY effective_from,id`, [ids, from, to])).rows : [];
  const itemRows = ids.length ? (await db.query(`${ITEM_SELECT} WHERE i.user_id=ANY($1::uuid[]) AND i.pay_month=$2 ORDER BY i.created_at,i.id`, [ids, month])).rows : [];
  const monthRows = ids.length ? (await db.query(`SELECT * FROM payroll_months WHERE user_id=ANY($1::uuid[]) AND pay_month=$2`, [ids, month])).rows : [];
  const employees = people.map(person => {
    const salaries = salaryRows.filter(row => row.user_id === person.id);
    const items = itemRows.filter(row => row.user_id === person.id).map(serializeItem);
    const live = payslipTotals(allocateSalaries(salaries, from, to), items);
    const state = serializeMonth(monthRows.find(row => row.user_id === person.id));
    const shown = state.lockedSnapshot ? { ...state.lockedSnapshot, netNegative: state.lockedSnapshot.net.startsWith("-") } : live;
    return {
      userId: person.id, displayName: person.display_name, username: person.username, role: person.role, isActive: person.is_active,
      ...shown,
      status: state.status, statusVersion: state.version, lockedAt: state.lockedAt,
      liveBase: live.base, liveNet: live.net,
      changedAfterLock: !!state.lockedSnapshot && (state.lockedSnapshot.base !== live.base || state.lockedSnapshot.net !== live.net),
      baseRecords: salaries.map(row => ({ id: row.id, monthlyAmount: formatMoney(row.monthly_amount), effectiveFrom: toDateOnly(row.effective_from), effectiveTo: row.effective_to ? toDateOnly(row.effective_to) : null, allocated: allocateSalaries([row], from, to) })),
      items
    };
  });
  const roles = [...new Set(employees.map(e => e.role))].map(role => {
    const members = employees.filter(e => e.role === role);
    return { role, employeeCount: members.length, ...sumTotals(members) };
  });
  return {
    month, period: { from, to },
    totals: { ...sumTotals(employees), employeeCount: employees.length, negativeCount: employees.filter(e => e.netNegative).length, lockedCount: employees.filter(e => e.status === "locked").length },
    roles, employees, note: NOTE
  };
}
