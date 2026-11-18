import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db.js";
import { writeAudit } from "../audit.js";
import { businessToday, diffDays, isIsoDate, toDateOnly } from "../lib/dates.js";
import { addMoney, formatMoney, parseMoney } from "../lib/money.js";
import { allocateSalaries } from "../lib/salary.js";
import { textField, uuid } from "../lib/commerce.js";
import { HttpError } from "../types.js";
import { createPayrollRouter } from "./payroll.js";

type Row = Record<string, any>;
export function createSalaryRouter(db: Pool): Router {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.actor || !["boss", "finance"].includes(req.actor.role)) return next(new HttpError(403, "仅财务与BOSS可查看工资"));
    if (!["GET", "HEAD"].includes(req.method) && req.actor.role !== "finance") return next(new HttpError(403, "工资由财务维护，BOSS仅可查看"));
    next();
  });
  // 月度工资单（提成/奖金/扣款手工项目、锁定状态）；继承上面的财务写、BOSS只读检查。
  router.use("/payroll", createPayrollRouter(db));
  // A salary-specific directory exposes no passwords, account controls or WeChat assets.
  router.get("/employees", async (_req, res, next) => {
    try {
      const result = await db.query("SELECT id,display_name,username,role,is_active FROM users WHERE account_kind='employee' ORDER BY display_name,id");
      res.json({ employees: result.rows.map(row => ({ id: row.id, displayName: row.display_name, username: row.username, role: row.role, isActive: row.is_active })) });
    } catch (e) { next(e); }
  });
  router.get("/summary", async (req, res, next) => {
    try {
      const today = businessToday();
      const from = String(req.query.from ?? `${today.slice(0, 8)}01`), to = String(req.query.to ?? today);
      if (!isIsoDate(from) || !isIsoDate(to) || from > to || diffDays(from, to) > 365) throw new HttpError(400, "请选择有效日期区间，最多366天");
      const userId = req.query.userId ? uuid(req.query.userId) : "";
      const rows = (await db.query(`SELECT s.*,s.xmin::text AS record_version,u.display_name,u.username,u.role,u.is_active
        FROM salaries s JOIN users u ON u.id=s.user_id
        WHERE s.effective_from<=$2 AND (s.effective_to IS NULL OR s.effective_to>=$1) AND ($3='' OR s.user_id::text=$3)
        ORDER BY u.display_name,s.effective_from,s.id`, [from, to, userId])).rows;
      const grouped = new Map<string, { userId: string; displayName: string; username: string; role: string; isActive: boolean; allocated: string; records: Row[] }>();
      for (const row of rows) {
        let employee = grouped.get(row.user_id);
        if (!employee) {
          employee = { userId: row.user_id, displayName: row.display_name, username: row.username, role: row.role, isActive: row.is_active, allocated: "0.00", records: [] };
          grouped.set(row.user_id, employee);
        }
        employee.records.push({ ...serialize(row), allocated: allocateSalaries([row], from, to) });
      }
      const employees = [...grouped.values()].map(employee => ({ ...employee, allocated: addMoney(employee.records.map(record => record.allocated)) }));
      const roles = [...new Set(employees.map(employee => employee.role))].map(role => ({ role, employeeCount: employees.filter(employee => employee.role === role).length, allocated: addMoney(employees.filter(employee => employee.role === role).map(employee => employee.allocated)) }));
      res.json({ period: { from, to }, totalAllocated: addMoney(employees.map(employee => employee.allocated)), employeeCount: employees.length, recordCount: rows.length, roles, employees, note: "仅核算人民币月基本工资，按生效区间和自然月天数分摊；岗位按员工当前角色归类。不含提成、奖金、扣款，不代表实发或已付款。" });
    } catch (e) { next(e); }
  });
  router.get("/", async (req, res, next) => {
    try {
      const userId = req.query.userId ? uuid(req.query.userId) : "";
      const rows = (await db.query(`SELECT s.*,s.xmin::text AS record_version,u.display_name,u.username,u.role,u.is_active FROM salaries s JOIN users u ON u.id=s.user_id WHERE ($1='' OR s.user_id::text=$1) ORDER BY u.display_name,s.effective_from DESC,s.id`, [userId])).rows;
      res.json({ salaries: rows.map(serialize) });
    } catch (e) { next(e); }
  });
  router.get("/:id/history", async (req, res, next) => {
    try {
      const id = uuid(req.params.id);
      if (!(await db.query("SELECT 1 FROM salaries WHERE id=$1", [id])).rowCount) throw new HttpError(404, "工资记录不存在");
      const rows = (await db.query(`SELECT a.id,a.action,a.before_data,a.after_data,a.created_at,u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='salary' AND a.entity_id=$1 ORDER BY a.created_at DESC,a.id DESC`, [id])).rows;
      res.json({ history: rows.map(row => ({ id: row.id, action: row.action, before: row.before_data, after: row.after_data, createdAt: row.created_at, actorName: row.actor_name ?? "历史操作人" })) });
    } catch (e) { next(e); }
  });
  const mutate = (handler: (client: PoolClient, req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    void withTransaction(db, (client) => handler(client, req))
      .then((result) => res.status(req.method === "POST" && !(result as { replayed?: boolean }).replayed ? 201 : 200).json(result))
      .catch((e: unknown) => {
        if (typeof e === "object" && e && "code" in e && e.code === "23P01") next(new HttpError(409, "该员工在此期间已有工资记录，请先调整生效区间，不能重叠"));
        else next(e);
      });
  };
  router.post("/", mutate(async (client, req) => {
    const userId = uuid(req.body?.userId), payload = readBody(req.body);
    await employeeLock(client, userId);
    const existing = (await client.query("SELECT *,xmin::text AS record_version FROM salaries WHERE user_id=$1 AND monthly_amount=$2 AND effective_from=$3 AND effective_to IS NOT DISTINCT FROM $4::date", [userId, payload.monthlyAmount, payload.effectiveFrom, payload.effectiveTo])).rows[0];
    if (existing) return { salary: serialize(existing), replayed: true };
    const saved = (await client.query("INSERT INTO salaries(user_id,monthly_amount,effective_from,effective_to,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *,xmin::text AS record_version", [userId, payload.monthlyAmount, payload.effectiveFrom, payload.effectiveTo, req.actor!.id])).rows[0];
    await writeAudit(client, { actorId: req.actor!.id, action: "salary_create", entityType: "salary", entityId: saved.id, after: { userId, ...payload }, ip: req.ip });
    return { salary: serialize(saved) };
  }));
  router.patch("/:id", mutate(async (client, req) => {
    const id = uuid(req.params.id), payload = readBody(req.body), reason = textField(req.body?.reason, "修改原因", 500);
    const target = (await client.query("SELECT user_id FROM salaries WHERE id=$1", [id])).rows[0];
    if (!target) throw new HttpError(404, "工资记录不存在");
    await employeeLock(client, target.user_id);
    const before = (await client.query("SELECT *,xmin::text AS record_version FROM salaries WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (String(req.body?.recordVersion ?? "") !== before.record_version) throw new HttpError(409, "工资记录已变更，请刷新后再修改");
    if (req.body?.userId && req.body.userId !== before.user_id) throw new HttpError(400, "不能把已有工资记录改到另一员工名下");
    const saved = (await client.query("UPDATE salaries SET monthly_amount=$2,effective_from=$3,effective_to=$4 WHERE id=$1 RETURNING *,xmin::text AS record_version", [id, payload.monthlyAmount, payload.effectiveFrom, payload.effectiveTo])).rows[0];
    await writeAudit(client, { actorId: req.actor!.id, action: "salary_update", entityType: "salary", entityId: id, before: serialize(before), after: { ...serialize(saved), reason }, ip: req.ip });
    return { salary: serialize(saved) };
  }));
  return router;
}
async function employeeLock(client: PoolClient, id: string) {
  const employee = (await client.query("SELECT id,account_kind FROM users WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!employee || employee.account_kind !== "employee") throw new HttpError(400, "工资只能关联员工，不能关联客服接待账号");
}
function readBody(body: Record<string, unknown> = {}) {
  const monthlyAmount = parseMoney(body.monthlyAmount, "月基本工资");
  const effectiveFrom = String(body.effectiveFrom ?? ""), effectiveTo = body.effectiveTo ? String(body.effectiveTo) : null;
  if (!isIsoDate(effectiveFrom) || (effectiveTo && (!isIsoDate(effectiveTo) || effectiveTo < effectiveFrom))) throw new HttpError(400, "工资生效日期无效，结束日不能早于开始日");
  return { monthlyAmount, effectiveFrom, effectiveTo };
}
function serialize(row: Row) {
  return { id: row.id, userId: row.user_id, displayName: row.display_name, username: row.username, role: row.role, isActive: row.is_active, monthlyAmount: formatMoney(row.monthly_amount), effectiveFrom: toDateOnly(row.effective_from), effectiveTo: row.effective_to ? toDateOnly(row.effective_to) : null, createdAt: row.created_at, recordVersion: row.record_version };
}
