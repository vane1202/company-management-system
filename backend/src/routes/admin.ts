import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { isIsoDate } from "../lib/dates.js";
import { hashPassword, validatePassword } from "../lib/password.js";
import { HttpError, type UserRole } from "../types.js";
import { isBossOrAdmin } from "../users.js";

const ROLES: UserRole[] = ["boss", "admin", "assistant", "ops", "editor", "cs", "cs_supervisor"];

export function createAdminRouter(db: Pool): Router {
  const router = Router();

  router.use((req, _res, next) => {
    if (!req.actor || !isBossOrAdmin(req.actor)) {
      next(new HttpError(403, "仅 Boss 或行政可管理编制"));
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
          ORDER BY t.name`
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

  router.get("/users", async (_req, res, next) => {
    try {
      const users = await query(
        db,
        `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.must_change_password, u.created_at,
                (
                  SELECT json_build_object('id', t.id, 'name', t.name)
                    FROM team_memberships m
                    JOIN teams t ON t.id = m.team_id
                   WHERE m.user_id = u.id AND m.end_date IS NULL
                   ORDER BY m.start_date DESC
                   LIMIT 1
                ) AS current_team
           FROM users u
          ORDER BY u.display_name`
      );
      res.json({
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          isActive: user.is_active,
          mustChangePassword: user.must_change_password,
          createdAt: user.created_at,
          currentTeam: user.current_team
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users", async (req, res, next) => {
    try {
      const username = String(req.body?.username ?? "").trim().toLowerCase();
      const displayName = String(req.body?.displayName ?? "").trim();
      const password = String(req.body?.password ?? "");
      const role = String(req.body?.role ?? "") as UserRole;
      const teamId = req.body?.teamId ? String(req.body.teamId) : "";
      const membershipStart = String(req.body?.membershipStart ?? "");
      const managedTeamIds = Array.isArray(req.body?.managedTeamIds)
        ? req.body.managedTeamIds.map(String)
        : [];
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
        throw new HttpError(400, "登录名须为 3-32 位小写字母、数字、下划线或短横线");
      }
      if (!displayName || displayName.length > 64) throw new HttpError(400, "姓名无效");
      if (!ROLES.includes(role)) throw new HttpError(400, "角色无效");
      validatePassword(password, username);
      const passwordHash = await hashPassword(password);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const user = await queryOne(
          client,
          `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
           VALUES ($1, $2, $3, $4, TRUE)
           RETURNING id, username, display_name, role, is_active, must_change_password`,
          [username, passwordHash, displayName, role]
        );
        if (teamId) {
          if (!membershipStart || !isIsoDate(membershipStart)) {
            throw new HttpError(400, "加入小组时须提供有效的归属起始日");
          }
          await client.query(
            `INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)`,
            [user!.id, teamId, membershipStart]
          );
        }
        if (role === "cs_supervisor") {
          for (const managedId of managedTeamIds) {
            await client.query(
              `INSERT INTO supervisor_scopes (supervisor_id, team_id, is_explicit_cross_grant, granted_by)
               VALUES ($1, $2, FALSE, $3)`,
              [user!.id, managedId, req.actor!.id]
            );
          }
        }
        await client.query("COMMIT");
        await writeAudit(db, {
          actorId: req.actor!.id,
          action: "user_create",
          entityType: "user",
          entityId: user!.id,
          after: { username, displayName, role, teamId: teamId || null },
          ip: req.ip
        });
        res.status(201).json({
          user: {
            id: user!.id,
            username: user!.username,
            displayName: user!.display_name,
            role: user!.role,
            isActive: user!.is_active,
            mustChangePassword: user!.must_change_password
          }
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  router.patch("/users/:id", async (req, res, next) => {
    try {
      const user = await queryOne<{ id: string; display_name: string; role: UserRole; is_active: boolean }>(
        db,
        "SELECT id, display_name, role, is_active FROM users WHERE id = $1",
        [req.params.id]
      );
      if (!user) throw new HttpError(404, "员工不存在");
      const displayName = req.body?.displayName !== undefined ? String(req.body.displayName).trim() : user.display_name;
      const role = req.body?.role !== undefined ? (String(req.body.role) as UserRole) : user.role;
      const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : user.is_active;
      if (!displayName) throw new HttpError(400, "姓名无效");
      if (!ROLES.includes(role)) throw new HttpError(400, "角色无效");
      await db.query(
        "UPDATE users SET display_name = $1, role = $2, is_active = $3, updated_at = now() WHERE id = $4",
        [displayName, role, isActive, user.id]
      );
      await writeAudit(db, {
        actorId: req.actor!.id,
        action: "user_update",
        entityType: "user",
        entityId: user.id,
        before: user,
        after: { displayName, role, isActive },
        ip: req.ip
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/transfer", async (req, res, next) => {
    try {
      const userId = String(req.params.id);
      const teamId = String(req.body?.teamId ?? "");
      const effectiveDate = String(req.body?.effectiveDate ?? "");
      if (!teamId) throw new HttpError(400, "请选择新小组");
      if (!isIsoDate(effectiveDate)) throw new HttpError(400, "生效日期无效");
      const current = await queryOne<{ id: string; team_id: string; start_date: string }>(
        db,
        `SELECT id, team_id, start_date::text FROM team_memberships
          WHERE user_id = $1 AND end_date IS NULL
          ORDER BY start_date DESC LIMIT 1`,
        [userId]
      );
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        if (current) {
          if (current.team_id === teamId) throw new HttpError(400, "员工已在该小组");
          if (current.start_date > effectiveDate) throw new HttpError(400, "调组日期不能早于当前归属起始日");
          const endDate = previousDay(effectiveDate);
          if (endDate >= current.start_date) {
            await client.query("UPDATE team_memberships SET end_date = $1 WHERE id = $2", [endDate, current.id]);
          } else {
            await client.query("UPDATE team_memberships SET end_date = start_date WHERE id = $1", [current.id]);
          }
        }
        await client.query(
          "INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)",
          [userId, teamId, effectiveDate]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await writeAudit(db, {
        actorId: req.actor!.id,
        action: "user_transfer",
        entityType: "user",
        entityId: userId,
        after: { teamId, effectiveDate },
        ip: req.ip
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

function previousDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}
