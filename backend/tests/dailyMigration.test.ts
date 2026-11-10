import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate, migrationsDir } from "../src/migrate.js";
import { assertNotDemoDatabase } from "./safeDatabase.js";

let admin: Pool;
let db: Pool;
const schema = `daily_upgrade_${randomBytes(8).toString("hex")}`;
let schemaCreated = false;
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL || "";
  if (assertNotDemoDatabase(raw).name !== "cms_daily_migration_test") throw new Error("仅允许独立库 cms_daily_migration_test");
  admin = new Pool({ connectionString: raw });
  expect((await admin.query("SELECT current_database() AS name")).rows[0].name).toBe("cms_daily_migration_test");
  await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
  await admin.query("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public");
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  db = new Pool({ connectionString: raw, options: `-c search_path=${schema},public` });
  await db.query("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  for (const file of ["001_init.sql", "002_review.sql"]) {
    await db.query(fs.readFileSync(path.join(migrationsDir(), file), "utf8"));
    await db.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
  }
});
afterAll(async () => {
  await db?.end();
  // 只清理本套件随机生成的新 schema，不清空任何已有 schema 或数据库。
  if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin?.end();
});
it("003 保留已有行和口径，同时允许多主页及多个人设，迁移不重复执行", async () => {
  const user = (await db.query("INSERT INTO users (username,password_hash,display_name,role) VALUES ('legacy_fixture','test-only','fixture','cs') RETURNING id")).rows[0].id;
  const team = (await db.query("INSERT INTO teams (name) VALUES ('fixture') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO fan_reports (user_id,team_id,business_date,added_count) VALUES ($1,$2,'2026-11-01',15)", [user, team]);
  for (const platform of ["A", "B"]) await db.query("INSERT INTO ops_reports (user_id,business_date,platform,promo_cost,promo_video_count) VALUES ($1,'2026-11-01',$2,8.25,1)", [user, platform]);
  await db.query("INSERT INTO editor_reports (user_id,business_date,shoot_count,finished_count,published_count,inventory_snapshot) VALUES ($1,'2026-11-01',3,4,7,9)", [user]);
  expect(await migrate(db)).toEqual(["003_daily_detail.sql", "004_cs_wechat_accounts.sql", "005_finance_role.sql", "006_order_workflow.sql", "007_payroll_items.sql", "008_production_cashflow.sql", "009_fan_leads.sql", "010_service_accounts.sql", "011_order_cancellations.sql", "012_paid_performance_after_sales.sql"]);
  expect((await db.query("SELECT account_kind,wechat_id FROM users WHERE id=$1", [user])).rows[0]).toEqual({ account_kind: "employee", wechat_id: null });
  expect((await db.query("SELECT added_count,ms_today,ws_today,page_name,review_status FROM fan_reports")).rows).toEqual([{ added_count: 15, ms_today: null, ws_today: null, page_name: "", review_status: "pending" }]);
  expect((await db.query("SELECT platform,persona_name,promo_cost,spend_usd FROM ops_reports ORDER BY platform")).rows).toEqual([
    { platform: "A", persona_name: "A", promo_cost: "8.25", spend_usd: null },
    { platform: "B", persona_name: "B", promo_cost: "8.25", spend_usd: null }
  ]);
  expect((await db.query("SELECT published_count,sent_to_ops_count,edit_count,inventory_snapshot FROM editor_reports")).rows[0]).toEqual({ published_count: 7, sent_to_ops_count: null, edit_count: null, inventory_snapshot: 9 });
  await db.query("INSERT INTO fan_reports (user_id,team_id,business_date,added_count,page_name,ms_today,ws_today) VALUES ($1,$2,'2026-11-01',0,'new page',1,2)", [user, team]);
  await db.query("INSERT INTO editor_reports (user_id,business_date,persona_name,shoot_count,finished_count,published_count,inventory_snapshot) VALUES ($1,'2026-11-01','new persona',1,0,0,2)", [user]);
  expect((await db.query("SELECT COUNT(*)::int AS count FROM fan_reports")).rows[0].count).toBe(2);
  expect((await db.query("SELECT COUNT(*)::int AS count FROM editor_reports")).rows[0].count).toBe(2);
  expect(await migrate(db)).toEqual([]);
});
