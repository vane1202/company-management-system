import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { query, queryOne, withTransaction } from "../db.js";
import { writeAudit } from "../audit.js";
import { businessToday } from "../lib/dates.js";
import { parseAccountId } from "../lib/csAccounts.js";
import { HttpError } from "../types.js";
import { assertTeamScope, managedTeamIds, membershipOnDate, toPublicUser, type DbUser } from "../users.js";
import { establishSession } from "./auth.js";

const browserKey = (req: Request) => createHash("sha256").update(req.sessionID).digest("hex");

export function createCsBindingsRouter(db: Pool, config: AppConfig) {
  const router = Router();
  const today = () => businessToday(new Date(), config.businessTimezone);
  const isEmployee = (req: Request) => req.actor?.role === "cs" && req.actor.accountKind === "employee";

  async function lockAccount(client: PoolClient, id: string) {
    const account = await queryOne<DbUser>(client,
      "SELECT * FROM users WHERE id=$1 AND account_kind IN ('cs_service','cs_wechat') FOR UPDATE", [id]);
    const membership = account && await membershipOnDate(client, id, today());
    if (!account || !membership) throw new HttpError(404, "接待号不存在或未分组");
    return { account, teamId: membership.team_id };
  }

  async function assertEmployeeTeam(client: PoolClient, id: string, teamId: string) {
    const member = await queryOne(client, `SELECT 1 FROM team_memberships m
      JOIN users u ON u.id=m.user_id JOIN teams t ON t.id=m.team_id
      WHERE m.user_id=$1 AND m.team_id=$2 AND u.role='cs' AND u.account_kind='employee'
        AND u.is_active AND NOT u.must_change_password AND t.is_active
        AND m.start_date <= $3 AND (m.end_date IS NULL OR m.end_date >= $3)`, [id, teamId, today()]);
    if (!member) throw new HttpError(403, "该客服不属于接待号所在小组");
  }

  router.get("/", async (req, res, next) => {
    try {
      const supervisor = req.actor!.role === "cs_supervisor";
      if (!supervisor && !isEmployee(req)) throw new HttpError(403, "无手机绑定权限");
      const ids = supervisor ? await managedTeamIds(db, req.actor!) : [];
      const bindings = await query(db, `SELECT b.id, b.account_id AS "accountId", b.label,
          b.state, e.display_name AS "employeeName"
        FROM cs_device_bindings b JOIN users e ON e.id=b.employee_id JOIN users a ON a.id=b.account_id
        WHERE a.is_active AND
          ((b.state='active' AND a.device_version=b.device_version)
          OR (b.state IN ('pending','approved') AND b.expires_at>now()))
          AND (($1 AND EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=a.id
            AND m.team_id=ANY($2::uuid[]) AND m.start_date<=$3 AND (m.end_date IS NULL OR m.end_date >= $3)))
            OR (NOT $1 AND b.browser_key=$4 AND b.employee_id=$5))
        ORDER BY b.requested_at DESC`, [supervisor, ids, today(), browserKey(req), req.actor!.id]);
      res.set("Cache-Control", "private, no-store").json({ bindings });
    } catch (error) { next(error); }
  });

  router.post("/", async (req, res, next) => {
    try {
      if (!isEmployee(req)) throw new HttpError(403, "请用个人客服账号申请绑定");
      const accountId = parseAccountId(req.body?.accountId);
      const label = String(req.body?.label ?? "").trim();
      if (!label || label.length > 64) throw new HttpError(400, "请填写 1–64 字的手机名称");
      await withTransaction(db, async client => {
        const { account, teamId } = await lockAccount(client, accountId);
        if (!account.is_active) throw new HttpError(409, "接待号已停用");
        await assertEmployeeTeam(client, req.actor!.id, teamId);
        await client.query(`INSERT INTO cs_device_bindings(account_id,employee_id,browser_key,label,state)
          VALUES($1,$2,$3,$4,'pending') ON CONFLICT(account_id,browser_key) DO UPDATE
          SET label=EXCLUDED.label,state='pending',requested_at=now(),expires_at=now()+interval '24 hours'
          WHERE cs_device_bindings.state='closed' OR cs_device_bindings.expires_at<=now()`,
          [accountId, req.actor!.id, browserKey(req), label]);
      });
      res.status(201).json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post("/:accountId/:action", async (req, res, next) => {
    try {
      const accountId = parseAccountId(req.params.accountId);
      const action = req.params.action;
      if (!["approve", "unbind", "activate"].includes(action)) throw new HttpError(404, "操作不存在");
      if (action === "activate" ? !isEmployee(req) : req.actor!.role !== "cs_supervisor") {
        throw new HttpError(403, "无手机绑定操作权限");
      }
      const bindingId = action === "unbind" ? null : parseAccountId(req.body?.bindingId);
      const service = await withTransaction(db, async client => {
        const { account, teamId } = await lockAccount(client, accountId);
        if (action !== "activate") await assertTeamScope(client, req.actor!, teamId);
        if (action !== "unbind" && !account.is_active) throw new HttpError(409, "接待号已停用");
        const binding = bindingId && await queryOne<{ employee_id: string; browser_key: string }>(client,
          "SELECT employee_id,browser_key FROM cs_device_bindings WHERE id=$1 AND account_id=$2 AND state=$3 AND expires_at>now()",
          [bindingId, accountId, action === "approve" ? "pending" : "approved"]);
        if (bindingId && !binding) throw new HttpError(409, "申请已处理或过期，请刷新");
        if (binding) await assertEmployeeTeam(client, binding.employee_id, teamId);

        if (action === "approve") {
          await client.query("UPDATE cs_device_bindings SET state='closed' WHERE account_id=$1 AND state='approved'", [accountId]);
          await client.query("UPDATE cs_device_bindings SET state='approved', device_version=$2 WHERE id=$1", [bindingId, account.device_version]);
        } else {
          if (action === "activate" && (!binding || binding.employee_id !== req.actor!.id || binding.browser_key !== browserKey(req))) {
            throw new HttpError(403, "请在发起申请的手机浏览器中继续");
          }
          const version = (account.device_version ?? 0) + 1;
          if (action === "activate") {
            const valid = await queryOne(client, "SELECT id FROM cs_device_bindings WHERE id=$1 AND device_version=$2", [bindingId, account.device_version]);
            if (!valid) throw new HttpError(409, "接待号已变更，请重新申请");
          }
          await client.query("UPDATE users SET device_version=$2 WHERE id=$1", [accountId, version]);
          await client.query("UPDATE cs_device_bindings SET state='closed' WHERE account_id=$1 AND state <> 'closed'", [accountId]);
          if (action === "activate") {
            await client.query("UPDATE cs_device_bindings SET state='active',device_version=$2 WHERE id=$1", [bindingId, version]);
            account.device_version = version;
          }
        }
        await writeAudit(client, { actorId: req.actor!.id, action: `cs_device_${action}`, entityType: "user", entityId: accountId, after: { bindingId }, ip: req.ip });
        return action === "activate" ? account : null;
      });
      if (service) {
        await establishSession(req, service);
        res.json({ user: toPublicUser(service), csrfToken: req.session.csrfToken });
      } else res.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}
