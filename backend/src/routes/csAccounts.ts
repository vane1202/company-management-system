import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { query, queryOne } from "../db.js";
import { writeAudit } from "../audit.js";
import { HttpError } from "../types.js";
import { businessToday, isIsoDate } from "../lib/dates.js";
import { hashPassword } from "../lib/password.js";
import { newRegistrationCode, normalizeRegistrationCode, parseAccountId, parseWechatId, registrationHash } from "../lib/csAccounts.js";
import { getBackfillDays } from "../settings.js";
import { assertTeamScope, isBossOrAdmin, managedTeamIds, membershipOnDate, toPublicUser, type DbUser } from "../users.js";
import { establishSession } from "./auth.js";
import type { AppConfig } from "../config.js";

export function createCsAccountsRouter(db: Pool, config: AppConfig): Router {
  const router = Router();
  router.use((req, _res, next) => {
    if (!req.actor || (!isBossOrAdmin(req.actor) && req.actor.role !== "cs_supervisor")) return next(new HttpError(403, "无权查看客服微信号"));
    next();
  });
  router.get("/teams", async (req, res, next) => {
    try {
      const ids = await managedTeamIds(db, req.actor!);
      res.json({ teams: await query(db, "SELECT id,name FROM teams WHERE id=ANY($1::uuid[]) AND is_active=TRUE ORDER BY name", [ids]) });
    } catch (error) { next(error); }
  });
  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const date = String(req.query.date ?? businessToday(new Date(), config.businessTimezone));
      if (!isIsoDate(date)) throw new HttpError(400, "业务日无效");
      const scopes = isBossOrAdmin(actor) ? null : await managedTeamIds(db, actor);
      const rows = await query(db, `SELECT u.id, u.wechat_id, u.phone_label, u.is_active, u.created_at,
        m.team_id, t.name AS team_name FROM users u
        LEFT JOIN LATERAL (SELECT team_id FROM team_memberships WHERE user_id=u.id AND start_date <= $1::date AND (end_date IS NULL OR end_date >= $1::date) ORDER BY start_date DESC LIMIT 1) m ON TRUE
        LEFT JOIN teams t ON t.id=m.team_id
        WHERE u.account_kind='cs_wechat' AND ($2::uuid[] IS NULL OR m.team_id=ANY($2::uuid[])) ORDER BY lower(u.wechat_id)`, [date, scopes]);
      res.json({ accounts: rows.map((row) => ({ id: row.id, wechatId: row.wechat_id, phoneLabel: row.phone_label, isActive: row.is_active, teamId: row.team_id, teamName: row.team_name, createdAt: row.created_at })) });
    } catch (error) { next(error); }
  });
  router.post("/registration-codes", async (req, res, next) => {
    try {
      if (!["admin", "cs_supervisor"].includes(req.actor!.role)) throw new HttpError(403, "仅后台管理员或本组主管可发放登记码");
      const boundUserId = req.body?.accountId ? parseAccountId(req.body.accountId) : null;
      const today = businessToday(new Date(), config.businessTimezone);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        let teamId: string;
        if (boundUserId) {
          const account = await queryOne<DbUser>(client, "SELECT * FROM users WHERE id=$1 AND account_kind='cs_wechat' FOR UPDATE", [boundUserId]);
          if (!account || !account.is_active) throw new HttpError(400, "客服微信不存在或已停用");
          const membership = await membershipOnDate(client, boundUserId, today);
          if (!membership) throw new HttpError(400, "请先维护该微信号的小组归属");
          teamId = membership.team_id;
          await client.query("UPDATE users SET device_version=device_version+1 WHERE id=$1", [boundUserId]);
          await client.query("UPDATE cs_registration_codes SET revoked_at=now() WHERE bound_user_id=$1 AND used_at IS NULL AND revoked_at IS NULL", [boundUserId]);
        } else teamId = parseAccountId(req.body?.teamId);
        await assertTeamScope(client, req.actor!, teamId);
        const team = await queryOne(client, "SELECT id FROM teams WHERE id=$1 AND is_active=TRUE", [teamId]);
        if (!team) throw new HttpError(400, "请选择有效小组");
        const code = newRegistrationCode();
        const saved = await queryOne(client, `INSERT INTO cs_registration_codes(code_hash,team_id,bound_user_id,created_by,expires_at) VALUES ($1,$2,$3,$4,now()+interval '24 hours') RETURNING id,expires_at`, [registrationHash(code), teamId, boundUserId, req.actor!.id]);
        await writeAudit(client, { actorId: req.actor!.id, action: "cs_registration_code_issue", entityType: "cs_registration_code", entityId: String(saved!.id), after: { teamId, accountId: boundUserId }, ip: req.ip });
        await client.query("COMMIT");
        res.setHeader("Cache-Control", "no-store");
        res.status(201).json({ code, expiresAt: saved!.expires_at, accountId: boundUserId, message: boundUserId ? "旧手机登录已失效，新码只能重新登记同一微信号" : "一次性登记码仅显示本次，有效期24小时" });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) { next(error); }
  });
  router.put("/:id/status", async (req, res, next) => {
    try {
      if (!["admin", "cs_supervisor"].includes(req.actor!.role)) throw new HttpError(403, "仅后台管理员或本组主管可管理客服微信");
      const id = parseAccountId(req.params.id);
      if (typeof req.body?.isActive !== "boolean") throw new HttpError(400, "状态无效");
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const before = await queryOne(client, "SELECT id,wechat_id,is_active FROM users WHERE id=$1 AND account_kind='cs_wechat' FOR UPDATE", [id]);
        if (!before) throw new HttpError(404, "客服微信不存在");
        await assertAccountScope(client, req.actor!, id, config);
        await client.query("UPDATE users SET is_active=$2,device_version=device_version+1,updated_at=now() WHERE id=$1", [id, req.body.isActive]);
        await client.query("UPDATE cs_registration_codes SET revoked_at=now() WHERE bound_user_id=$1 AND used_at IS NULL", [id]);
        await writeAudit(client, { actorId: req.actor!.id, action: "cs_account_status", entityType: "user", entityId: id, before, after: { isActive: req.body.isActive }, ip: req.ip });
        await client.query("COMMIT"); res.json({ ok: true });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) { next(error); }
  });
  router.patch("/:id", async (req, res, next) => {
    try {
      if (!["admin", "cs_supervisor"].includes(req.actor!.role)) throw new HttpError(403, "无权更新客服微信");
      const id = parseAccountId(req.params.id);
      const wechatId = parseWechatId(req.body?.wechatId);
      const phoneLabel = String(req.body?.phoneLabel ?? "").trim();
      if (phoneLabel.length > 64) throw new HttpError(400, "设备备注最多64字");
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const before = await queryOne(client, "SELECT id,wechat_id,phone_label FROM users WHERE id=$1 AND account_kind='cs_wechat' FOR UPDATE", [id]);
        if (!before) throw new HttpError(404, "客服微信不存在");
        await assertAccountScope(client, req.actor!, id, config);
        const changedId = before.wechat_id !== wechatId;
        await client.query("UPDATE users SET wechat_id=$2,display_name=$2,phone_label=$3,device_version=device_version+$4,updated_at=now() WHERE id=$1", [id, wechatId, phoneLabel || null, changedId ? 1 : 0]);
        if (changedId) await client.query("UPDATE cs_registration_codes SET revoked_at=now() WHERE bound_user_id=$1 AND used_at IS NULL", [id]);
        await writeAudit(client, { actorId: req.actor!.id, action: "cs_account_update", entityType: "user", entityId: id, before, after: { wechatId, phoneLabel }, ip: req.ip });
        await client.query("COMMIT"); res.json({ ok: true, needsRegistration: changedId });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) { next(error); }
  });
  return router;
}

async function assertAccountScope(db: Parameters<typeof membershipOnDate>[0], actor: Parameters<typeof assertTeamScope>[1], id: string, config: AppConfig) {
  if (actor.role === "admin") return;
  const membership = await membershipOnDate(db, id, businessToday(new Date(), config.businessTimezone));
  if (!membership) throw new HttpError(403, "无权管理该微信号");
  await assertTeamScope(db, actor, membership.team_id);
}

export function createCsDeviceRegistrationRouter(db: Pool, config: AppConfig): Router {
  const router = Router();
  router.post("/", rateLimit({ windowMs: config.loginWindowMs, limit: config.loginMaxAttempts, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: "登记尝试过于频繁，请稍后再试" }); } }), async (req, res, next) => {
    try {
      if (req.actor) throw new HttpError(409, "请先退出当前账号，再登记客服手机");
      const wechatId = parseWechatId(req.body?.wechatId);
      const code = normalizeRegistrationCode(req.body?.registrationCode);
      const phoneLabel = String(req.body?.phoneLabel ?? "").trim();
      if (phoneLabel.length > 64) throw new HttpError(400, "设备备注最多64字，无需填写手机号");
      const client = await db.connect();
      let saved: DbUser;
      try {
        await client.query("BEGIN");
        // All bound-code paths lock the account before its codes, including issue/disable.
        // Recheck validity after acquiring locks to serialize concurrent redemption/revocation.
        const preview = await queryOne<{ bound_user_id: string | null }>(client, "SELECT bound_user_id FROM cs_registration_codes WHERE code_hash=$1", [registrationHash(code)]);
        if (preview?.bound_user_id) await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [preview.bound_user_id]);
        const invite = await queryOne<{ id: string; team_id: string; bound_user_id: string | null }>(client, `SELECT id,team_id,bound_user_id FROM cs_registration_codes WHERE code_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`, [registrationHash(code)]);
        if (!invite) throw new HttpError(400, "登记码无效、已使用或已过期，请联系管理员");
        const activeTeam = await queryOne(client, "SELECT id FROM teams WHERE id=$1 AND is_active=TRUE", [invite.team_id]);
        if (!activeTeam) throw new HttpError(400, "登记小组已停用，请联系管理员");
        if (invite.bound_user_id) {
          const existing = await queryOne<DbUser>(client, "SELECT * FROM users WHERE id=$1 AND account_kind='cs_wechat' FOR UPDATE", [invite.bound_user_id]);
          if (!existing || !existing.is_active || existing.wechat_id?.toLowerCase() !== wechatId.toLowerCase()) throw new HttpError(400, "此登记码与填写的微信号不匹配，或账号已停用");
          saved = (await queryOne<DbUser>(client, "UPDATE users SET phone_label=$2,device_version=device_version+1,updated_at=now() WHERE id=$1 RETURNING *", [existing.id, phoneLabel || existing.phone_label]))!;
        } else {
          const exists = await queryOne(client, "SELECT id FROM users WHERE lower(wechat_id)=lower($1)", [wechatId]);
          if (exists) throw new HttpError(409, "此微信号已登记，请向管理员获取该号的重新登记码");
          const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
          saved = (await queryOne<DbUser>(client, `INSERT INTO users(username,password_hash,display_name,role,must_change_password,account_kind,wechat_id,phone_label,device_version) VALUES ($1,$2,$3,'cs',FALSE,'cs_wechat',$3,$4,1) RETURNING *`, ["csdev_" + randomBytes(12).toString("hex"), passwordHash, wechatId, phoneLabel || null]))!;
          const today = businessToday(new Date(), config.businessTimezone);
          await client.query("INSERT INTO team_memberships(user_id,team_id,start_date) VALUES($1,$2,$3)", [saved.id, invite.team_id, today]);
        }
        await client.query("UPDATE cs_registration_codes SET used_at=now(),used_by=$2 WHERE id=$1", [invite.id, saved.id]);
        await writeAudit(client, { actorId: saved.id, action: invite.bound_user_id ? "cs_phone_reregister" : "cs_wechat_register", entityType: "user", entityId: saved.id, after: { wechatId: saved.wechat_id, teamId: invite.team_id, phoneLabel: saved.phone_label }, ip: req.ip });
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      await establishSession(req, saved);
      res.setHeader("Cache-Control", "no-store");
      res.json({ user: toPublicUser(saved), csrfToken: req.session.csrfToken, today: businessToday(new Date(), config.businessTimezone), backfillDays: await getBackfillDays(db, config.fanReportBackfillDays), disclaimer: "数据归属于登记的客服微信号；登记不等于微信官方身份认证。" });
    } catch (error) { next(error); }
  });
  return router;
}
