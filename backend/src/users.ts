import type { Pool, PoolClient } from "pg";
import { HttpError, type PublicUser, type UserRole } from "./types.js";
import { query, queryOne } from "./db.js";
import { addDays } from "./lib/dates.js";

export type DbUser = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  account_kind?: "employee" | "cs_wechat" | "cs_service";
  wechat_id?: string | null;
  service_platform?: 'whatsapp'|'messenger'|'legacy_wechat';
  service_account_label?:string|null;
  phone_label?: string | null;
  device_version?: number;
  session_version?: number;
};

export type Actor = PublicUser;

export function normalizeUsername(input: unknown): string {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

export function toPublicUser(row: DbUser): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    accountKind: row.account_kind ?? "employee",
    wechatId: row.wechat_id ?? null,
    servicePlatform:row.account_kind==='cs_service'||row.account_kind==='cs_wechat'?row.service_platform??'legacy_wechat':null,
    accountIdentifier:row.wechat_id??null,
    serviceAccountLabel:row.service_account_label??row.wechat_id??null,
    phoneLabel: row.phone_label ?? null,
    deviceVersion: row.device_version ?? 0,
    sessionVersion: row.session_version ?? 0
  };
}

export async function findUserById(db: Pool | PoolClient, id: string): Promise<DbUser | undefined> {
  return queryOne<DbUser>(db, "SELECT * FROM users WHERE id = $1", [id]);
}

export async function findUserByUsername(db: Pool | PoolClient, username: string): Promise<DbUser | undefined> {
  return queryOne<DbUser>(db, "SELECT * FROM users WHERE username = $1", [normalizeUsername(username)]);
}

export function isBossOrAdmin(actor: Actor): boolean {
  return actor.role === "boss" || actor.role === "admin";
}

export function assertActive(user: DbUser | undefined): DbUser {
  if (!user || !user.is_active) {
    throw new HttpError(401, "账号不存在或已停用");
  }
  return user;
}

export async function requireUser(db: Pool | PoolClient, id: string): Promise<DbUser> {
  const user = await findUserById(db, id);
  if (!user) throw new HttpError(404, "员工不存在");
  return user;
}

export async function managedTeamIds(db: Pool | PoolClient, actor: Actor): Promise<string[]> {
  if (isBossOrAdmin(actor)) {
    const rows = await query<{ id: string }>(db, "SELECT id FROM teams WHERE is_active = TRUE");
    return rows.map((row) => row.id);
  }
  if (actor.role !== "cs_supervisor") return [];
  const rows = await query<{ team_id: string }>(
    db,
    "SELECT team_id FROM supervisor_scopes WHERE supervisor_id = $1",
    [actor.id]
  );
  return rows.map((row) => row.team_id);
}

export async function assertTeamScope(db: Pool | PoolClient, actor: Actor, teamId: string): Promise<void> {
  if (isBossOrAdmin(actor)) return;
  const ids = await managedTeamIds(db, actor);
  if (!ids.includes(teamId)) {
    throw new HttpError(403, "无权访问该小组");
  }
}

export async function membershipOnDate(
  db: Pool | PoolClient,
  userId: string,
  businessDate: string
): Promise<{ team_id: string; name: string } | undefined> {
  return queryOne<{ team_id: string; name: string }>(
    db,
    `SELECT m.team_id, t.name
       FROM team_memberships m
       JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = $1
        AND m.start_date <= $2::date
        AND (m.end_date IS NULL OR m.end_date >= $2::date)
      ORDER BY m.start_date DESC
      LIMIT 1`,
    [userId, businessDate]
  );
}

export async function membersOnDate(
  db: Pool | PoolClient,
  teamId: string,
  businessDate: string
): Promise<{ user_id: string; display_name: string; username: string; wechat_id: string | null; account_kind: string }[]> {
  return query(
    db,
    `SELECT u.id AS user_id, u.display_name, u.username, u.service_account_label AS wechat_id, u.account_kind
       FROM team_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1
        AND m.start_date <= $2::date
        AND (m.end_date IS NULL OR m.end_date >= $2::date)
      ORDER BY u.display_name, u.username`,
    [teamId, businessDate]
  );
}

/**
 * Updates an employee or service account's active team membership as of `effectiveDate`.
 * Closes any prior open membership on the day before `effectiveDate` (or removes it when
 * replaced on the exact same start date) so same-day queries never see duplicate teams.
 */
export async function setUserTeamMembership(
  client: PoolClient,
  options: {
    userId: string;
    teamId: string | null;
    effectiveDate: string;
    errorIfSameTeam?: boolean;
  }
): Promise<{ changed: boolean; previousTeamId: string | null }> {
  const { userId, teamId, effectiveDate, errorIfSameTeam = false } = options;
  const current = await queryOne<{ id: string; team_id: string; start_date: string }>(
    client,
    `SELECT id, team_id, start_date::text
       FROM team_memberships
      WHERE user_id = $1 AND end_date IS NULL
      ORDER BY start_date DESC
      LIMIT 1
      FOR UPDATE`,
    [userId]
  );

  if (current) {
    if (teamId && current.team_id === teamId) {
      if (errorIfSameTeam) throw new HttpError(400, "员工已在该小组");
      return { changed: false, previousTeamId: current.team_id };
    }
    if (current.start_date > effectiveDate) {
      throw new HttpError(400, teamId ? "调组日期不能早于当前归属起始日" : "移出日期不能早于当前归属起始日");
    }
    if (current.start_date === effectiveDate) {
      await client.query("DELETE FROM team_memberships WHERE id = $1", [current.id]);
    } else {
      await client.query("UPDATE team_memberships SET end_date = $1 WHERE id = $2", [
        addDays(effectiveDate, -1),
        current.id
      ]);
    }
  } else if (!teamId) {
    return { changed: false, previousTeamId: null };
  }

  if (teamId) {
    await client.query(
      "INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)",
      [userId, teamId, effectiveDate]
    );
  }
  return { changed: true, previousTeamId: current?.team_id ?? null };
}

/**
 * Updates an employee's active team memberships to match `teamIds` as of `effectiveDate`.
 * Supports an employee belonging to multiple teams simultaneously (e.g. 客服一组 + 志伟组).
 * Existing memberships kept in `teamIds` remain untouched; removed memberships are closed
 * on the day before `effectiveDate` (or deleted if started on `effectiveDate`).
 */
export async function setUserTeamMemberships(
  client: PoolClient,
  options: {
    userId: string;
    teamIds: string[];
    effectiveDate: string;
  }
): Promise<{ changed: boolean; previousTeamIds: string[] }> {
  const { userId, effectiveDate } = options;
  const nextIds = [...new Set(options.teamIds.filter(Boolean))];
  const nextSet = new Set(nextIds);
  const currentRows = await query<{ id: string; team_id: string; start_date: string }>(
    client,
    `SELECT id, team_id, start_date::text
       FROM team_memberships
      WHERE user_id = $1 AND end_date IS NULL
      ORDER BY start_date ASC, id ASC
      FOR UPDATE`,
    [userId]
  );
  const previousTeamIds = [...new Set(currentRows.map((row) => row.team_id))];
  const currentSet = new Set(previousTeamIds);
  const toRemove = currentRows.filter((row) => !nextSet.has(row.team_id));
  const toAdd = nextIds.filter((id) => !currentSet.has(id));

  if (!toRemove.length && !toAdd.length) {
    return { changed: false, previousTeamIds };
  }

  for (const row of toRemove) {
    if (row.start_date > effectiveDate) {
      throw new HttpError(400, nextIds.length ? "调组日期不能早于当前归属起始日" : "移出日期不能早于当前归属起始日");
    }
    if (row.start_date === effectiveDate) {
      await client.query("DELETE FROM team_memberships WHERE id = $1", [row.id]);
    } else {
      await client.query("UPDATE team_memberships SET end_date = $1 WHERE id = $2", [
        addDays(effectiveDate, -1),
        row.id
      ]);
    }
  }

  for (const teamId of toAdd) {
    await client.query(
      "INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)",
      [userId, teamId, effectiveDate]
    );
  }

  return { changed: true, previousTeamIds };
}
