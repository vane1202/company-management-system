import { randomBytes } from "node:crypto";
import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { hashPassword } from "../lib/password.js";
import { businessToday } from "../lib/dates.js";

if (process.env.SEED_DEMO !== "1") {
  console.error("演示数据默认不写入。确认使用虚构数据时请设置 SEED_DEMO=1");
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);

const today = businessToday(new Date(), config.businessTimezone);
const passwordOf = (label: string) => `${label}${randomBytes(3).toString("hex")}9a`;

type SeedUser = {
  username: string;
  displayName: string;
  role: string;
  password: string;
  team?: string;
  scopes?: string[];
};

const users: SeedUser[] = [
  { username: "demo_boss", displayName: "演示老板", role: "boss", password: passwordOf("Boss") },
  { username: "demo_admin", displayName: "演示行政", role: "admin", password: passwordOf("Admin") },
  { username: "demo_sup_a", displayName: "演示主管甲", role: "cs_supervisor", password: passwordOf("SupA"), scopes: ["一组"] },
  { username: "demo_sup_b", displayName: "演示主管乙", role: "cs_supervisor", password: passwordOf("SupB"), scopes: ["二组"] },
  { username: "demo_cs_a1", displayName: "演示客服甲一", role: "cs", password: passwordOf("CsA1"), team: "一组" },
  { username: "demo_cs_a2", displayName: "演示客服甲二", role: "cs", password: passwordOf("CsA2"), team: "一组" },
  { username: "demo_cs_b1", displayName: "演示客服乙一", role: "cs", password: passwordOf("CsB1"), team: "二组" },
  { username: "demo_ops", displayName: "演示运营", role: "ops", password: passwordOf("Ops") },
  { username: "demo_editor", displayName: "演示拍剪", role: "editor", password: passwordOf("Edit") }
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const teamA = await client.query(
    "INSERT INTO teams (name, wechat_group_note) VALUES ($1, $2) RETURNING id",
    ["一组", "演示用微信群A（虚构）"]
  );
  const teamB = await client.query(
    "INSERT INTO teams (name, wechat_group_note) VALUES ($1, $2) RETURNING id",
    ["二组", "演示用微信群B（虚构）"]
  );
  const teamIds: Record<string, string> = { 一组: teamA.rows[0].id, 二组: teamB.rows[0].id };

  for (const item of users) {
    const hash = await hashPassword(item.password);
    const inserted = await client.query(
      `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id`,
      [item.username, hash, item.displayName, item.role]
    );
    const userId = inserted.rows[0].id;
    if (item.team) {
      await client.query(
        "INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)",
        [userId, teamIds[item.team], today]
      );
    }
    for (const scope of item.scopes ?? []) {
      await client.query(
        `INSERT INTO supervisor_scopes (supervisor_id, team_id, is_explicit_cross_grant)
         VALUES ($1, $2, FALSE)`,
        [userId, teamIds[scope]]
      );
    }
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}

console.log("已写入虚构演示账号（请自行保存，不会再次显示明文密码）：");
for (const item of users) {
  console.log(`${item.displayName}\t${item.username}\t${item.password}`);
}
await pool.end();
