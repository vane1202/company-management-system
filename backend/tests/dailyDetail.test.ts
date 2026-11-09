import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Express } from "express";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { businessToday, addDays as shiftDate } from "../src/lib/dates.js";
import { assertNotDemoDatabase } from "./safeDatabase.js";

const ORIGIN = "http://127.0.0.1:13080";
const PASSWORD = "DailyDetailTest1234";
describe("日报明细与模块开关 PostgreSQL 集成", () => {
  let db: Pool;
  let app: Express;
  let today: string;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    // 不回退到业务 DATABASE_URL，不自动创建或改名已有库。
    const url = process.env.TEST_DATABASE_URL || "";
    const target = assertNotDemoDatabase(url);
    if (target.name !== "cms_daily_detail_test") throw new Error("仅允许专用隔离库 cms_daily_detail_test");
    process.env.DATABASE_URL = url;
    process.env.SESSION_SECRET = "daily-detail-test-session-secret-not-for-production";
    process.env.APP_ORIGIN = ORIGIN;
    process.env.LOGIN_MAX_ATTEMPTS = "100";
    const config = loadConfig();
    db = createPool(url);
    expect((await db.query("SELECT current_database() AS name")).rows[0].name).toBe("cms_daily_detail_test");
    await migrate(db);
    await db.query(`TRUNCATE review_actions, fan_report_revisions, fan_reports, ops_reports, editor_reports,
      orders, salaries, notes, audit_logs, supervisor_scopes, team_memberships, teams, session, users RESTART IDENTITY CASCADE`);
    await db.query("DELETE FROM app_settings WHERE key = 'business_modules'");
    today = businessToday(new Date(), config.businessTimezone);
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [["admin", "admin"], ["boss", "boss"], ["assistant", "assistant"], ["staff", "cs"], ["ops", "ops"], ["editor", "editor"], ["supervisor", "cs_supervisor"]]) {
      ids[name] = (await db.query("INSERT INTO users (username,password_hash,display_name,role,must_change_password) VALUES ($1,$2,$1,$3,FALSE) RETURNING id", [name, hash, role])).rows[0].id;
    }
    ids.team = (await db.query("INSERT INTO teams (name) VALUES ('daily-detail-fixture') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO team_memberships (user_id,team_id,start_date) VALUES ($1,$2,$3)", [ids.staff, ids.team, shiftDate(today, -10)]);
    app = createApp(db, config);
  });
  afterAll(async () => { await db?.end(); });
  async function login(name: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/auth/csrf").expect(200)).body.csrfToken;
    const auth = await agent.post("/api/auth/login").set("Origin", ORIGIN).set("X-CSRF-Token", csrf).send({ username: name, password: PASSWORD }).expect(200);
    return { agent, put: (path: string, body: Record<string, unknown>) => agent.put(path).set("Origin", ORIGIN).set("X-CSRF-Token", auth.body.csrfToken).send(body), post: (path: string, body: Record<string, unknown>) => agent.post(path).set("Origin", ORIGIN).set("X-CSRF-Token", auth.body.csrfToken).send(body) };
  }
  const fan = (pageName: string) => ({ pageName, msToday: 3, wsToday: 2, msMonth: 40, wsMonth: 21, validToday: 9, commReplied: 8, commReadNoReply: 7, commUnread: 6, commInvalid: 5, note: "fixture" });
  it("同日多主页、旧数、零和原三日补报边界都保留", async () => {
    const cs = await login("staff");
    await cs.put("/api/fan-reports", { businessDate: today, addedCount: 15 }).expect(200);
    await cs.put("/api/fan-reports", { businessDate: today, ...fan("A") }).expect(200);
    await cs.put("/api/fan-reports", { businessDate: today, ...fan("B"), msToday: 0, wsToday: 0 }).expect(200);
    const rows = (await cs.agent.get("/api/fan-reports/me").expect(200)).body.reports;
    expect(rows).toHaveLength(3);
    expect(rows.find((r: any) => r.isLegacyUnclassified).addedCount).toBe(15);
    const boss = await login("boss");
    const summary = (await boss.agent.get(`/api/fan-reports/summary?date=${today}`).expect(200)).body.teams[0];
    expect(summary).toMatchObject({ totalAdded: 20, reportedCount: 1, statsIncomplete: true, legacyUnclassifiedAdded: 15 });
    await cs.put("/api/fan-reports", { businessDate: shiftDate(today, -2), ...fan("A") }).expect(200);
    await cs.put("/api/fan-reports", { businessDate: shiftDate(today, -3), ...fan("A") }).expect(403);
  });
  it("新字段修改直接保存，助理没有审核或业务权限", async () => {
    const cs=await login("staff");
    const changed=(await cs.put("/api/fan-reports",{businessDate:today,...fan("A"),commUnread:99}).expect(200)).body.report;
    expect(changed.commUnread).toBe(99); expect(changed).not.toHaveProperty("reviewStatus");
    const asst=await login("assistant");
    await asst.agent.get("/api/reviews").expect(403);
    await asst.post("/api/reviews",{action:"approve"}).expect(403);
    await asst.put("/api/fan-reports",{businessDate:today,...fan("C")}).expect(403);
  });
  it("加粉 7 天日序列按业务日分组：无填报为 null、今日标记未完成、权限同经营汇总", async () => {
    const boss = await login("boss");
    const series = (await boss.agent.get(`/api/dashboard/series?to=${today}&days=7`).expect(200)).body;
    expect(series).toMatchObject({ from: shiftDate(today, -6), to: today, today });
    expect(series.days).toHaveLength(7);
    const byDate = Object.fromEntries(series.days.map((d: any) => [d.date, d]));
    // 今日：旧未分类 15 + 主页 A 5 + 主页 B 0 = 20，与汇总口径一致。
    expect(byDate[today]).toMatchObject({ fanAdded: 20, reports: 3, partial: true, validToday: 18 });
    expect(byDate[shiftDate(today, -2)]).toMatchObject({ fanAdded: 5, reports: 1, partial: false });
    expect(byDate[shiftDate(today, -1)]).toMatchObject({ fanAdded: null, validToday: null, reports: 0 });
    const summary = (await boss.agent.get(`/api/dashboard/summary?from=${today}&to=${today}`).expect(200)).body;
    expect(summary.metrics.fanAddedTotal).toBe(byDate[today].fanAdded);
    for (const bad of ["days=0", "days=32", "days=x", "to=2026-13-01"]) await boss.agent.get(`/api/dashboard/series?${bad}`).expect(400);
    for (const name of ["admin", "staff", "supervisor", "ops", "editor", "assistant"]) await (await login(name)).agent.get("/api/dashboard/series").expect(403);
  });
  it("主管汇总返回当天四种沟通状态（含已读不回、未读），只含授权小组", async () => {
    const sup = await login("supervisor");
    expect((await sup.agent.get(`/api/fan-reports/summary?date=${today}`).expect(200)).body.teams).toEqual([]);
    await db.query("INSERT INTO supervisor_scopes(supervisor_id,team_id,granted_by) VALUES($1,$2,$3)", [ids.supervisor, ids.team, ids.boss]);
    const team = (await sup.agent.get(`/api/fan-reports/summary?date=${today}`).expect(200)).body.teams[0];
    // 主页 A 已被改为未读 99；主页 B 为 6。旧未分类行不含状态，故四态合计可小于加粉总数。
    expect(team).toMatchObject({ totalAdded: 20, commReplied: 16, commReadNoReply: 14, commUnread: 105, commInvalid: 10, statsIncomplete: true });
  });
  it("运营成本独立上报且美元不进入原估算，拍剪多个人设不覆盖", async () => {
    const boss = await login("boss");
    const ops = await login("ops");
    const before = (await boss.agent.get("/api/dashboard/summary?preset=day").expect(200)).body.metrics.estimate;
    const result = await ops.put("/api/ops-reports", { businessDate: today, personaName: "A", spendUsd: "29.20", consultCount: 1, consultCostUsd: "29.28", clickCount: 5, ctrPercent: "1.25", balanceUsd: "99.90" }).expect(200);
    expect(result.body.report).toMatchObject({ consultCostUsd: "29.28", promoCost: "0.00", promoCostCurrency: "unknown_legacy" });
    const dashboard = (await boss.agent.get("/api/dashboard/summary?preset=day").expect(200)).body;
    expect(dashboard.metrics.estimate).toBe(before);
    expect(dashboard.opsUsd).toMatchObject({ spendUsd: "29.20", endingBalanceUsd: "99.90" });
    const editor = await login("editor");
    for (const [date, personaName, inventorySnapshot] of [[shiftDate(today, -1), "A", 10], [today, "A", 6], [today, "B", 4]]) {
      await editor.put("/api/editor-reports", { businessDate: date, personaName, shootCount: 2, editCount: 1, sentToOpsCount: 1, inventorySnapshot }).expect(200);
    }
    const summary = (await editor.agent.get("/api/editor-reports/summary").expect(200)).body;
    expect(summary).toMatchObject({ endingInventory: 10, sentToOpsCount: 3, publishedCount: 0 });
    const reports=(await boss.agent.get("/api/ops-reports").expect(200)).body.reports;
    expect(reports[0].consultCostUsd).toBe("29.28");
    expect((await boss.agent.get("/api/editor-reports").expect(200)).body.reports[0].sentToOpsCount).toBe(1);
  });
  it("模块开关在真实 API 生效、版本冲突受控、重新启用不丢记录", async () => {
    const boss = await login("admin");
    const cs = await login("staff");
    const config = (await boss.agent.get("/api/modules").expect(200)).body;
    await cs.put("/api/modules", { version: config.version, modules: { fans: false } }).expect(403);
    const updated = (await boss.put("/api/modules", { version: config.version, modules: { fans: false } }).expect(200)).body;
    await cs.put("/api/fan-reports", { businessDate: today, ...fan("blocked") }).expect(403);
    const original = (await cs.agent.get("/api/fan-reports/me").expect(200)).body.reports;
    await boss.put("/api/modules", { version: config.version, modules: { fans: true } }).expect(409);
    await boss.put("/api/modules", { version: updated.version, modules: { fans: true } }).expect(200);
    expect((await cs.agent.get("/api/fan-reports/me").expect(200)).body.reports).toEqual(original);
  });
});

