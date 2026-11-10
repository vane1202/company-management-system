import type { Pool, PoolClient } from "pg";
import { HttpError, type PublicUser, type UserRole } from "./types.js";
import { query, queryOne } from "./db.js";

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
};

export type Actor = PublicUser;

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
    deviceVersion: row.device_version ?? 0
  };
}

export async function findUserById(db: Pool | PoolClient, id: string): Promise<DbUser | undefined> {
  return queryOne<DbUser>(db, "SELECT * FROM users WHERE id = $1", [id]);
}

export async function findUserByUsername(db: Pool | PoolClient, username: string): Promise<DbUser | undefined> {
  return queryOne<DbUser>(db, "SELECT * FROM users WHERE username = $1", [username.toLowerCase()]);
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
