import { Router } from "express";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { writeAudit } from "../audit.js";
import { query, queryOne, withTransaction } from "../db.js";
import { businessToday } from "../lib/dates.js";
import { hashPassword, validatePassword } from "../lib/password.js";
import { HttpError } from "../types.js";
import { managedTeamIds, normalizeUsername } from "../users.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCsLoginsRouter(db: Pool, config: AppConfig): Router {
  const router = Router();
  router.use((req, _res, next) => {
    if (req.actor?.role !== "cs_supervisor") {
      next(new HttpError(403, "仅客服主管可开通本组客服登录"));
      return;
    }
    next();
  });

  router.get("/", async (req, res, next) => {
    try {
      const teamIds = await managedTeamIds(db, req.actor!);
      const teams = teamIds.length
        ? await query<{ id: string; name: string }>(db, "SELECT id, name FROM teams WHERE is_active = TRUE AND id = ANY($1::uuid[]) ORDER BY name", [teamIds])
        : [];
      const users = teamIds.length
        ? await query<{ id: string; username: string; display_name: string; is_active: boolean; must_change_password: boolean; team_id: string; team_name: string }>(
            db,
            `SELECT u.id, u.username, u.display_name, u.is_active, u.must_change_password,
                    (array_agg(t.id ORDER BY t.name))[1] AS team_id,
                    string_agg(DISTINCT t.name, '、' ORDER BY t.name) AS team_name
               FROM users u
               JOIN team_memberships m ON m.user_id = u.id AND m.end_date IS NULL
               JOIN teams t ON t.id = m.team_id
              WHERE u.role = 'cs' AND u.account_kind = 'employee' AND t.id = ANY($1::uuid[])
              GROUP BY u.id, u.username, u.display_name, u.is_active, u.must_change_password
              ORDER BY min(t.name), u.display_name`,
            [teamIds]
          )
        : [];
      res.json({
        teams: teams.map((team) => ({ id: team.id, name: team.name })),
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          isActive: user.is_active,
          mustChangePassword: user.must_change_password,
          teamId: user.team_id,
          teamName: user.team_name
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const displayName = String(req.body?.displayName ?? "").trim();
      const password = String(req.body?.password ?? "");
      const teamId = String(req.body?.teamId ?? "");
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) throw new HttpError(400, "登录名须为 3-32 位小写字母、数字、下划线或短横线");
      if (!displayName || displayName.length > 64) throw new HttpError(400, "姓名无效");
      if (!UUID_RE.test(teamId)) throw new HttpError(400, "请选择你负责的小组");
      const allowed = await managedTeamIds(db, req.actor!);
      if (!allowed.includes(teamId)) throw new HttpError(403, "只能给自己负责的小组开通客服");
      validatePassword(password, username);
      const passwordHash = await hashPassword(password);
      const today = businessToday(new Date(), config.businessTimezone);
      const user = await withTransaction(db, async (client) => {
        const team = await queryOne(client, "SELECT id FROM teams WHERE id = $1 AND is_active = TRUE FOR SHARE", [teamId]);
        if (!team) throw new HttpError(400, "请选择你负责的小组");
        const created = await queryOne<{ id: string; username: string; display_name: string; must_change_password: boolean }>(
          client,
          `INSERT INTO users (username, password_hash, display_name, role, must_change_password, account_kind)
             VALUES ($1, $2, $3, 'cs', TRUE, 'employee')
             RETURNING id, username, display_name, must_change_password`,
          [username, passwordHash, displayName]
        );
        await client.query("INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)", [created!.id, teamId, today]);
        await writeAudit(client, {
          actorId: req.actor!.id,
          action: "user_create",
          entityType: "user",
          entityId: created!.id,
          after: { username, displayName, role: "cs", teamId, mustChangePassword: true, openedBy: "cs_supervisor" },
          ip: req.ip
        });
        return created!;
      });
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          mustChangePassword: user.must_change_password
        }
      });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "23505") {
        next(new HttpError(409, "登录名已被使用，请更换"));
        return;
      }
      next(error);
    }
  });

  return router;
}
