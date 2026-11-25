import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne, withTransaction } from "../db.js";
import { isIsoDate } from "../lib/dates.js";
import { generateTemporaryPassword, hashPassword, validatePassword } from "../lib/password.js";
import { teamOrderSql } from "../lib/teamOrder.js";
import { HttpError, type UserRole } from "../types.js";
import { isBossOrAdmin, normalizeUsername, setUserTeamMembership, setUserTeamMemberships } from "../users.js";

const ROLES: UserRole[] = ["boss", "admin", "finance", "assistant", "ops", "editor", "cs", "cs_supervisor", "warehouse"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAdminRouter(db: Pool): Router {
  const router = Router();

  router.use((req, _res, next) => {
    if (!req.actor || req.actor.role !== "admin") {
      next(new HttpError(403, "仅后台管理员可管理账号和小组"));
      return;
    }
    next();
  });

  router.get("/teams", async (_req, res, next) => {
    try {
      const teams = await query(
        db,
        `SELECT t.id, t.name, t.wechat_group_note, t.is_active, t.created_at,
                COALESCE(s.supervisors, '[]'::json) AS supervisors
           FROM teams t
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object(
               'id', u.id, 'displayName', u.display_name, 'crossGrant', ss.is_explicit_cross_grant
             ) ORDER BY u.display_name) AS supervisors
               FROM supervisor_scopes ss
               JOIN users u ON u.id = ss.supervisor_id
              WHERE ss.team_id = t.id
           ) s ON TRUE
          ORDER BY ${teamOrderSql("t")}`
      );
      res.json({
        teams: teams.map((team) => ({
          id: team.id,
          name: team.name,
          wechatGroupNote: team.wechat_group_note,
          isActive: team.is_active,
          createdAt: team.created_at,
          supervisors: team.supervisors
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/teams", async (req, res, next) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      const wechatGroupNote = req.body?.wechatGroupNote ? String(req.body.wechatGroupNote).trim() : null;
      if (!name || name.length > 64) throw new HttpError(400, "小组名称无效");
      const team = await queryOne(
        db,
        `INSERT INTO teams (name, wechat_group_note) VALUES ($1, $2)
         RETURNING id, name, wechat_group_note, is_active, created_at`,
        [name, wechatGroupNote]
      );
      await writeAudit(db, {
        actorId: req.actor!.id,
        action: "team_create",
        entityType: "team",
        entityId: team!.id,
        after: { name, wechatGroupNote },
        ip: req.ip
      });
      res.status(201).json({
        team: {
          id: team!.id,
          name: team!.name,
          wechatGroupNote: team!.wechat_group_note,
          isActive: team!.is_active
        }
      });
    } catch (error) {
      next(error);
    }
  });

  
  router.patch("/teams/:id", async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "小组不存在");
      const name = String(req.body?.name ?? "").trim();
      if (!name || name.length > 64) throw new HttpError(400, "小组名称无效");
      const before = await queryOne<{ id: string; name: string }>(db, "SELECT id, name FROM teams WHERE id = $1", [id]);
      if (!before) throw new HttpError(404, "小组不存在");
      if (before.name !== name) {
        const duplicate = await queryOne(db, "SELECT id FROM teams WHERE name = $1 AND id <> $2", [name, id]);
        if (duplicate) throw new HttpError(409, "已有同名小组");
        await queryOne(db, "UPDATE teams SET name = $1 WHERE id = $2", [name, id]);
        await writeAudit(db, {
          actorId: req.actor!.id,
          action: "team_update",
          entityType: "team",
          entityId: id,
          before: { name: before.name },
          after: { name },
          ip: req.ip
        });
      }
      res.json({ team: { id, name } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/teams/:id", async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "小组不存在");
      const before = await queryOne<{ id: string; name: string }>(db, "SELECT id, name FROM teams WHERE id = $1", [id]);
      if (!before) throw new HttpError(404, "小组不存在");
      const links = await queryOne<{ members: number; supervisors: number; reports: number; leads: number; codes: number; orders: number }>(
        db,
        `SELECT
           (SELECT count(*)::int FROM team_memberships WHERE team_id = $1) AS members,
           (SELECT count(*)::int FROM supervisor_scopes WHERE team_id = $1) AS supervisors,
           (SELECT count(*)::int FROM fan_reports WHERE team_id = $1) AS reports,
           (SELECT count(*)::int FROM fan_leads WHERE team_id = $1) AS leads,
           (SELECT count(*)::int FROM cs_registration_codes WHERE team_id = $1) AS codes,
           (SELECT count(*)::int FROM orders WHERE performance_team_id = $1) AS orders`,
        [id]
      );
      const parts: string[] = [];
      if (links?.members) parts.push(links.members + " 条员工归属");
      if (links?.supervisors) parts.push(links.supervisors + " 条主管负责范围");
      if (links?.reports) parts.push(links.reports + " 条加粉日报");
      if (links?.leads) parts.push(links.leads + " 条客户线索");
      if (links?.codes) parts.push(links.codes + " 条登记码");
      if (links?.orders) parts.push(links.orders + " 笔业绩订单");
      if (parts.length) throw new HttpError(409, "这个小组还有" + parts.join("、") + "，不能删除。可以改名。");
      try {
        await queryOne(db, "DELETE FROM teams WHERE id = $1", [id]);
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "23503") {
          throw new HttpError(409, "这个小组还有员工或业务记录，不能删除。可以改名。");
        }
        throw error;
      }
      await writeAudit(db, {
        actorId: req.actor!.id,
        action: "team_delete",
        entityType: "team",
        entityId: id,
        before: { name: before.name },
        ip: req.ip
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/users", async (_req, res, next) => {
    try {
      const users = await query(
        db,
        `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.must_change_password, u.created_at, u.account_kind, u.wechat_id, u.phone_label,
                (
                  SELECT json_build_object('id', t.id, 'name', t.name)
                    FROM team_memberships m
                    JOIN teams t ON t.id = m.team_id
                   WHERE m.user_id = u.id AND m.end_date IS NULL
                   ORDER BY m.start_date DESC
                   LIMIT 1
                ) AS current_team,
                (
                  SELECT COALESCE(
                    json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY ${teamOrderSql("t")}, m.start_date),
                    '[]'::json
                  )
                    FROM (
                      SELECT DISTINCT ON (team_id) team_id, start_date
                        FROM team_memberships
                       WHERE user_id = u.id AND end_date IS NULL
                       ORDER BY team_id, start_date DESC
                    ) m
                    JOIN teams t ON t.id = m.team_id
                ) AS current_teams
           FROM users u
          WHERE u.account_kind = 'employee' AND u.employee_removed_at IS NULL AND NOT u.payroll_only
          ORDER BY u.display_name`
      );
      const scopes = await query<{ supervisor_id: string; team_id: string }>(db, "SELECT supervisor_id,team_id FROM supervisor_scopes");
      res.json({
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          accountKind: user.account_kind,
          wechatId: user.wechat_id,
          phoneLabel: user.phone_label,
          isActive: user.is_active,
          mustChangePassword: user.must_change_password,
          createdAt: user.created_at,
          currentTeam: user.current_team,
          currentTeams: Array.isArray(user.current_teams) ? user.current_teams : (user.current_team ? [user.current_team] : []),
          managedTeamIds: scopes.filter((scope) => scope.supervisor_id === user.id).map((scope) => scope.team_id)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users", async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const displayName = String(req.body?.displayName ?? "").trim();
      const password = String(req.body?.password ?? "");
      const role = String(req.body?.role ?? "") as UserRole;
      const teamId = req.body?.teamId ? String(req.body.teamId) : "";
      const teamIds: string[] = Array.isArray(req.body?.teamIds)
        ? [...new Set<string>(req.body.teamIds.map(String).filter(Boolean))]
        : teamId
          ? [teamId]
          : [];
      const membershipStart = String(req.body?.membershipStart ?? "");
      const managedTeamIds = Array.isArray(req.body?.managedTeamIds)
        ? req.body.managedTeamIds.map(String)
        : [];
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
        throw new HttpError(400, "登录名须为 3-32 位小写字母、数字、下划线或短横线");
      }
      if (!displayName || displayName.length > 64) throw new HttpError(400, "姓名无效");
      if (!ROLES.includes(role)) throw new HttpError(400, "角色无效");
      if (role === "assistant") throw new HttpError(400, "助理审核流程已停用，请选择其他角色");
      validatePassword(password, username);
      const passwordHash = await hashPassword(password);
      const user = await withTransaction(db, async (client) => {
        const created = await queryOne(
          client,
          `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
           VALUES ($1, $2, $3, $4, TRUE)
           RETURNING id, username, display_name, role, is_active, must_change_password`,
          [username, passwordHash, displayName, role]
        );
        if (teamIds.length && role !== "cs_supervisor") {
          if (teamIds.some((id) => !UUID_RE.test(id))) throw new HttpError(400, "请选择有效小组");
          const found = await query(client, "SELECT id FROM teams WHERE id = ANY($1::uuid[]) AND is_active = TRUE FOR SHARE", [teamIds]);
          if (found.length !== teamIds.length) throw new HttpError(400, "请选择有效小组");
          if (!membershipStart || !isIsoDate(membershipStart)) {
            throw new HttpError(400, "加入小组时须提供有效的归属起始日");
          }
          for (const tid of teamIds) {
            await client.query(
              `INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)`,
              [created!.id, tid, membershipStart]
            );
          }
        }
        if (role === "cs_supervisor") {
          for (const managedId of managedTeamIds) {
            await client.query(
              `INSERT INTO supervisor_scopes (supervisor_id, team_id, is_explicit_cross_grant, granted_by)
               VALUES ($1, $2, FALSE, $3)`,
              [created!.id, managedId, req.actor!.id]
            );
          }
        }
        await writeAudit(client, {
          actorId: req.actor!.id,
          action: "user_create",
          entityType: "user",
          entityId: created!.id,
          after: { username, displayName, role, teamId: teamIds[0] || null, teamIds },
          ip: req.ip
        });
        return created!;
      });
      res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          isActive: user.is_active,
          mustChangePassword: user.must_change_password
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/users/:id", async (req, res, next) => {
    let client: PoolClient | undefined;
    try {
      client = await db.connect();
      await client.query("BEGIN");
      // Serialize employee role/status changes so the last active admin is preserved.
      await client.query("SELECT pg_advisory_xact_lock(13080, 5)");
      const user = await queryOne<{ id: string; username: string; display_name: string; role: UserRole; is_active: boolean; account_kind: string }>(
        client,
        "SELECT id, username, display_name, role, is_active, account_kind FROM users WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!user) throw new HttpError(404, "员工不存在");
      if (["cs_wechat","cs_service"].includes(user.account_kind??"")) throw new HttpError(400, "客服接待账号请在客服接待账号页面管理，不可修改为员工或其他角色");
      const displayName = req.body?.displayName !== undefined ? String(req.body.displayName).trim() : user.display_name;
      const username = req.body?.username !== undefined ? normalizeUsername(req.body.username) : user.username;
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) throw new HttpError(400, "登录名须为 3-32 位小写字母、数字、下划线或短横线");
      if (username !== user.username) {
        const duplicate = await queryOne(client, "SELECT id FROM users WHERE username = $1 AND id <> $2", [username, user.id]);
        if (duplicate) throw new HttpError(409, "登录名已被使用，请更换");
      }
      const role = req.body?.role !== undefined ? (String(req.body.role) as UserRole) : user.role;
      if (req.body?.isActive !== undefined && typeof req.body.isActive !== "boolean") throw new HttpError(400, "账号状态无效");
      const isActive = req.body?.isActive !== undefined ? req.body.isActive : user.is_active;
      if (!displayName || displayName.length > 64) throw new HttpError(400, "姓名须为 1-64 个字符");
      if (!ROLES.includes(role)) throw new HttpError(400, "角色无效");
      if (role === "assistant" && user.role !== "assistant") throw new HttpError(400, "助理审核流程已停用，请选择其他角色");
      if (user.role === "admin" && user.is_active && (role !== "admin" || !isActive)) {
        const other = await queryOne(client, "SELECT id FROM users WHERE role='admin' AND is_active=TRUE AND id<>$1 LIMIT 1", [user.id]);
        if (!other) throw new HttpError(400, "至少保留一个启用的后台管理员，不能停用或更改最后一个管理员的角色");
      }
      await client.query(
        "UPDATE users SET display_name = $1, role = $2, is_active = $3, username = $5, updated_at = now() WHERE id = $4",
        [displayName, role, isActive, user.id, username]
      );
      const shouldRevoke = !isActive || role !== user.role || username !== user.username;
      if (shouldRevoke) {
        await revokeEmployeeSessions(client, user.id);
      }
      await writeAudit(client, {
        actorId: req.actor!.id,
        action: "user_update",
        entityType: "user",
        entityId: user.id,
        before: user,
        after: { username, displayName, role, isActive, ...(shouldRevoke ? { sessionsRevoked: true } : {}) },
        ip: req.ip
      });
      await client.query("COMMIT"); res.json({ ok: true });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => { client?.release(true); client = undefined; });
      next(error);
    } finally { client?.release(); }
  });

  router.post("/users/:id/reset-password", async (req, res, next) => {
    try {
      const id = String(req.params.id ?? "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "员工标识无效");
      if (id === req.actor!.id) throw new HttpError(400, "不能重置当前登录管理员自己的密码，请使用修改密码功能");
      const generate = req.body?.generate === true && !req.body?.temporaryPassword;
      const result = await withTransaction(db, async (client) => {
        const user = await queryOne<{ id: string; username: string; account_kind: string }>(
          client,
          "SELECT id, username, account_kind FROM users WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!user) throw new HttpError(404, "员工不存在");
        if (["cs_wechat", "cs_service"].includes(user.account_kind ?? "")) {
          throw new HttpError(400, "客服接待账号不使用员工密码，请由主管重新发放登记码");
        }
        const temporaryPassword = generate
          ? generateTemporaryPassword(user.username)
          : String(req.body?.temporaryPassword ?? "");
        validatePassword(temporaryPassword, user.username);
        const passwordHash = await hashPassword(temporaryPassword);
        await client.query(
          "UPDATE users SET password_hash = $1, must_change_password = TRUE, session_version = session_version + 1, updated_at = now() WHERE id = $2",
          [passwordHash, user.id]
        );
        await client.query("DELETE FROM session WHERE sess->>'userId' = $1", [user.id]);
        await writeAudit(client, {
          actorId: req.actor!.id,
          action: "user_password_reset",
          entityType: "user",
          entityId: user.id,
          after: { mustChangePassword: true, sessionsRevoked: true, generated: generate },
          ip: req.ip
        });
        return generate ? { temporaryPassword } : {};
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, mustChangePassword: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/users/:id", async (req, res, next) => {
    try {
      const id = String(req.params.id ?? "");
      const actor = req.actor!;
      if (!UUID_RE.test(id)) throw new HttpError(400, "员工标识无效");
      if (id === actor.id) throw new HttpError(400, "不能删除当前登录账号");
      await withTransaction(db, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(250025)");
        const user = await queryOne<{ username: string; role: UserRole; is_active: boolean }>(
          client,
          "SELECT username, role, is_active FROM users WHERE id = $1 AND account_kind = 'employee' AND employee_removed_at IS NULL FOR UPDATE",
          [id]
        );
        if (!user) throw new HttpError(404, "员工账号不存在");
        if (user.role === "admin") {
          throw new HttpError(403, "不能删除后台管理员账号");
        }
        if (user.role === "boss" && user.is_active) {
          const other = await queryOne(client,
            "SELECT id FROM users WHERE role = 'boss' AND is_active AND id <> $1 LIMIT 1",
            [id]
          );
          if (!other) throw new HttpError(409, "不能删除最后一个启用的 BOSS 账号");
        }
        await client.query(
          "UPDATE users SET is_active = FALSE, employee_removed_at = now(), updated_at = now() WHERE id = $1",
          [id]
        );
        await revokeEmployeeSessions(client, id);
        await writeAudit(client, {
          actorId: actor.id,
          action: "employee_account_removed",
          entityType: "user",
          entityId: id,
          before: { username: user.username, role: user.role, isActive: user.is_active },
          after: { removed: true, sessionsRevoked: true },
          ip: req.ip
        });
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/revoke-sessions", async (req, res, next) => {
    try {
      const id = String(req.params.id ?? "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "员工标识无效");
      if (id === req.actor!.id) throw new HttpError(400, "请使用退出登录结束当前会话");
      await withTransaction(db, async (client) => {
        const user = await queryOne<{ id: string; account_kind: string }>(
          client,
          "SELECT id, account_kind FROM users WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!user) throw new HttpError(404, "员工不存在");
        if (["cs_wechat", "cs_service"].includes(user.account_kind ?? "")) {
          throw new HttpError(400, "客服接待账号请在客服接待账号页面停用或换机");
        }
        await revokeEmployeeSessions(client, user.id);
        await writeAudit(client, {
          actorId: req.actor!.id,
          action: "user_sessions_revoked",
          entityType: "user",
          entityId: user.id,
          after: { sessionsRevoked: true },
          ip: req.ip
        });
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/transfer", async (req, res, next) => {
    try {
      const userId = String(req.params.id ?? "");
      if (!UUID_RE.test(userId)) throw new HttpError(400, "员工标识无效");
      const hasTeamIds = Boolean(req.body && Object.prototype.hasOwnProperty.call(req.body, "teamIds"));
      const hasTeamId = Boolean(req.body && Object.prototype.hasOwnProperty.call(req.body, "teamId"));
      if (!hasTeamIds && !hasTeamId) {
        throw new HttpError(400, "请选择新小组");
      }
      const effectiveDate = String(req.body?.effectiveDate ?? "");
      if (!isIsoDate(effectiveDate)) throw new HttpError(400, "生效日期无效");
      if (hasTeamIds) {
        if (!Array.isArray(req.body.teamIds)) throw new HttpError(400, "小组列表无效");
        const nextTeamIds: string[] = [...new Set<string>(req.body.teamIds.map((v: unknown) => String(v ?? "").trim()).filter(Boolean))];
        if (nextTeamIds.some((id) => !UUID_RE.test(id))) throw new HttpError(400, "请选择有效小组");
        await withTransaction(db, async (client) => {
          const user = await queryOne<{ id: string; account_kind: string; role: UserRole }>(
            client,
            "SELECT id, account_kind, role FROM users WHERE id = $1 FOR UPDATE",
            [userId]
          );
          if (!user) throw new HttpError(404, "员工不存在");
          if (["cs_wechat", "cs_service"].includes(user.account_kind ?? "")) {
            throw new HttpError(400, "客服接待账号请在客服账号管理页面调整小组");
          }
          if (nextTeamIds.length) {
            const found = await query(client, "SELECT id FROM teams WHERE id = ANY($1::uuid[]) AND is_active = TRUE FOR SHARE", [nextTeamIds]);
            if (found.length !== nextTeamIds.length) throw new HttpError(400, "请选择有效小组");
          }
          const result = await setUserTeamMemberships(client, {
            userId,
            teamIds: nextTeamIds,
            effectiveDate
          });
          if (result.changed) {
            await writeAudit(client, {
              actorId: req.actor!.id,
              action: "user_transfer",
              entityType: "user",
              entityId: userId,
              before: { teamIds: result.previousTeamIds },
              after: { teamIds: nextTeamIds, effectiveDate },
              ip: req.ip
            });
          }
        });
        res.json({ ok: true });
        return;
      }
      const rawTeamId = req.body.teamId === null || req.body.teamId === undefined ? "" : String(req.body.teamId).trim();
      if (rawTeamId && !UUID_RE.test(rawTeamId)) throw new HttpError(400, "请选择有效小组");

      await withTransaction(db, async (client) => {
        const user = await queryOne<{ id: string; account_kind: string; role: UserRole }>(
          client,
          "SELECT id, account_kind, role FROM users WHERE id = $1 FOR UPDATE",
          [userId]
        );
        if (!user) throw new HttpError(404, "员工不存在");
        if (["cs_wechat", "cs_service"].includes(user.account_kind ?? "")) {
          throw new HttpError(400, "客服接待账号请在客服账号管理页面调整小组");
        }
        const nextTeamId = rawTeamId || null;
        if (nextTeamId) {
          const team = await queryOne(client, "SELECT id FROM teams WHERE id = $1 AND is_active = TRUE FOR SHARE", [nextTeamId]);
          if (!team) throw new HttpError(400, "请选择有效小组");
        }
        const result = await setUserTeamMembership(client, {
          userId,
          teamId: nextTeamId,
          effectiveDate,
          errorIfSameTeam: Boolean(nextTeamId)
        });
        if (result.changed) {
          await writeAudit(client, {
            actorId: req.actor!.id,
            action: "user_transfer",
            entityType: "user",
            entityId: userId,
            before: { teamId: result.previousTeamId },
            after: { teamId: nextTeamId, effectiveDate },
            ip: req.ip
          });
        }
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/scopes", async (req, res, next) => {
    try {
      const supervisorId = String(req.params.id);
      const teamId = String(req.body?.teamId ?? "");
      const cross = Boolean(req.body?.crossGrant);
      if (!teamId) throw new HttpError(400, "请选择小组");
      await db.query(
        `INSERT INTO supervisor_scopes (supervisor_id, team_id, is_explicit_cross_grant, granted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (supervisor_id, team_id)
         DO UPDATE SET is_explicit_cross_grant = EXCLUDED.is_explicit_cross_grant`,
        [supervisorId, teamId, cross, req.actor!.id]
      );
      await writeAudit(db, {
        actorId: req.actor!.id,
        action: "supervisor_scope_grant",
        entityType: "supervisor_scope",
        entityId: supervisorId,
        after: { teamId, crossGrant: cross },
        ip: req.ip
      });
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  router.put("/users/:id/scopes", async (req, res, next) => {
    try {
      const teamIds = req.body?.teamIds;
      if (!Array.isArray(teamIds) || teamIds.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))) throw new HttpError(400, "小组范围无效");
      const unique = [...new Set(teamIds)] as string[];
      await withTransaction(db, async (client) => {
        const user = await queryOne(client, "SELECT id,role FROM users WHERE id=$1 AND account_kind='employee' FOR UPDATE", [req.params.id]);
        if (!user || user.role !== "cs_supervisor") throw new HttpError(400, "只能为客服主管设置负责小组");
        const teams = await query(client, "SELECT id FROM teams WHERE id=ANY($1::uuid[]) AND is_active=TRUE", [unique]);
        if (teams.length !== unique.length) throw new HttpError(400, "包含无效小组");
        const before = await query(client, "SELECT team_id FROM supervisor_scopes WHERE supervisor_id=$1", [user.id]);
        await client.query("DELETE FROM supervisor_scopes WHERE supervisor_id=$1", [user.id]);
        for (const id of unique) await client.query("INSERT INTO supervisor_scopes(supervisor_id,team_id,granted_by) VALUES($1,$2,$3)", [user.id,id,req.actor!.id]);
        await writeAudit(client, { actorId: req.actor!.id, action: "supervisor_scopes_update", entityType: "user", entityId: String(user.id), before: { scopes: before }, after: { teamIds: unique }, ip: req.ip });
      });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.delete("/users/:id/scopes/:teamId", async (req, res, next) => {
    try {
      await db.query("DELETE FROM supervisor_scopes WHERE supervisor_id = $1 AND team_id = $2", [
        req.params.id,
        req.params.teamId
      ]);
      await writeAudit(db, {
        actorId: req.actor!.id,
        action: "supervisor_scope_revoke",
        entityType: "supervisor_scope",
        entityId: req.params.id,
        after: { teamId: req.params.teamId },
        ip: req.ip
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/settings", async (_req, res, next) => {
    try {
      const rows = await query<{ key: string; value: string }>(db, "SELECT key, value FROM app_settings");
      res.json({ settings: Object.fromEntries(rows.map((row) => [row.key, row.value])) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/settings", async (req, res, next) => {
    try {
      if (req.body?.fan_report_backfill_days !== undefined) {
        const days = Number(req.body.fan_report_backfill_days);
        if (!Number.isInteger(days) || days < 1 || days > 60) {
          throw new HttpError(400, "补报窗口须为 1 到 60 的整数");
        }
        await db.query(
          `INSERT INTO app_settings (key, value) VALUES ('fan_report_backfill_days', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [String(days)]
        );
        await writeAudit(db, {
          actorId: req.actor!.id,
          action: "settings_update",
          entityType: "app_settings",
          entityId: "fan_report_backfill_days",
          after: { days },
          ip: req.ip
        });
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function revokeEmployeeSessions(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    "UPDATE users SET session_version = session_version + 1, updated_at = now() WHERE id = $1",
    [userId]
  );
  await client.query("DELETE FROM session WHERE sess->>'userId' = $1", [userId]);
}
