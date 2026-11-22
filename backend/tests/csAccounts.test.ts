import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Express } from "express";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { businessToday } from "../src/lib/dates.js";
import { registrationHash } from "../src/lib/csAccounts.js";
import { assertNotDemoDatabase } from "./safeDatabase.js";

const ORIGIN = "http://127.0.0.1:13080";
const PASSWORD = "CsAccountFixture1234";
describe("客服微信登记与数据归属（独立 PostgreSQL 库）", () => {
  let db: Pool;
  let app: Express;
  let today: string;
  const ids: Record<string, string> = {};
  type Client = { agent: ReturnType<typeof request.agent>; token: string };
  let boss: Client;
  let admin: Client;
  let registrar: Client;
  let device: Client;
  let device2: Client;
  function write(client: Client, method: "post" | "put" | "patch", path: string, body: object) {
    return client.agent[method](path).set("Origin", ORIGIN).set("X-CSRF-Token", client.token).send(body);
  }
  async function anonymous(): Promise<Client> {
    const agent = request.agent(app);
    return { agent, token: (await agent.get("/api/auth/csrf").expect(200)).body.csrfToken };
  }
  async function login(username: string) {
    const client = await anonymous();
    const result = await write(client, "post", "/api/auth/login", { username, password: PASSWORD }).expect(200);
    client.token = result.body.csrfToken;
    return client;
  }
  async function code(payload = { teamId: ids.teamA } as { teamId?: string; accountId?: string }) {
    const result = await write(registrar, "post", "/api/cs-accounts/registration-codes", payload).expect(201);
    expect(result.headers["cache-control"]).toBe("no-store");
    return result.body.code as string;
  }
  async function register(client: Client, wechatId: string, registrationCode: string) {
    const result = await write(client, "post", "/api/auth/cs-device", { wechatId, registrationCode, phoneLabel: "fixture-phone" }).expect(200);
    client.token = result.body.csrfToken;
    expect(result.body.user).toMatchObject({ accountKind: "cs_wechat", wechatId, role: "cs", mustChangePassword: false });
    const cookies: unknown = result.headers["set-cookie"];
    const cookie = Array.isArray(cookies) ? cookies.join(";") : String(cookies ?? "");
    expect(cookie).toContain("HttpOnly");
    const expiration = /Expires=([^;]+)/.exec(cookie)?.[1];
    expect(new Date(expiration!).getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
    return result.body.user.id as string;
  }
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL || "";
    if (assertNotDemoDatabase(url).name !== "cms_cs_accounts_test") throw Error("仅允许专用隔离库 cms_cs_accounts_test");
    process.env.DATABASE_URL = url;
    process.env.SESSION_SECRET = "cs-accounts-fixture-secret-not-for-production";
    process.env.APP_ORIGIN = ORIGIN;
    process.env.LOGIN_MAX_ATTEMPTS = "200";
    const config = loadConfig();
    db = createPool(url);
    expect((await db.query("SELECT current_database() AS name")).rows[0].name).toBe("cms_cs_accounts_test");
    await migrate(db);
    await db.query("TRUNCATE users,teams,session RESTART IDENTITY CASCADE");
    await db.query("DELETE FROM app_settings WHERE key='business_modules'");
    today = businessToday(new Date(), config.businessTimezone);
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [["admin", "admin"], ["unassigned", "cs_supervisor"], ["boss", "boss"], ["supervisor", "cs_supervisor"], ["legacy", "cs"]]) {
      ids[name] = (await db.query("INSERT INTO users(username,password_hash,display_name,role,must_change_password) VALUES($1,$2,$1,$3,FALSE) RETURNING id", [name, hash, role])).rows[0].id;
    }
    for (const team of ["teamA", "teamB"]) ids[team] = (await db.query("INSERT INTO teams(name) VALUES($1) RETURNING id", [team])).rows[0].id;
    ids.registrar = (await db.query("INSERT INTO users(username,password_hash,display_name,role,must_change_password) VALUES('registrar',$1,'登记主管','cs_supervisor',FALSE) RETURNING id", [hash])).rows[0].id;
    for (const team of [ids.teamA, ids.teamB]) await db.query("INSERT INTO supervisor_scopes(supervisor_id,team_id,granted_by) VALUES($1,$2,$3)", [ids.registrar, team, ids.admin]);
    await db.query("INSERT INTO supervisor_scopes(supervisor_id,team_id,granted_by) VALUES($1,$2,$3)", [ids.supervisor, ids.teamA, ids.boss]);
    await db.query("INSERT INTO team_memberships(user_id,team_id,start_date) VALUES($1,$2,$3)", [ids.legacy, ids.teamA, today]);
    await db.query("INSERT INTO fan_reports(user_id,team_id,business_date,added_count) VALUES($1,$2,$3,15)", [ids.legacy, ids.teamA, today]);
    app = createApp(db, config);
    boss = await login("boss");
    admin = await login("admin");
    registrar = await login("registrar");
  });
  afterAll(async () => { await db?.end(); });

  it("新码登记固定微信主体，Cookie 保留30天，登记码单次使用且不存明文", async () => {
    const registrationCode = await code();
    device = await anonymous();
    ids.wxA = await register(device, "Fixture_WeChat_A", registrationCode);
    const stored = (await db.query("SELECT code_hash,used_by FROM cs_registration_codes WHERE code_hash=$1", [registrationHash(registrationCode)])).rows[0];
    expect(stored.used_by).toBe(ids.wxA);
    expect(stored.code_hash).not.toBe(registrationCode);
    const other = await anonymous();
    await write(other, "post", "/api/auth/cs-device", { wechatId: "Fixture_WeChat_A", registrationCode }).expect(400);
    const logs = JSON.stringify((await db.query("SELECT before_data,after_data FROM audit_logs")).rows);
    expect(logs.includes(registrationCode)).toBe(false);
    await device.agent.get("/api/admin/users").expect(403);
    await device.agent.get("/api/salaries").expect(403);
    await device.agent.get("/api/dashboard/summary").expect(403);
    await write(device, "post", "/api/cs-accounts/registration-codes", { teamId: ids.teamA }).expect(403);
  });
  it("加粉和订单只能写入当前微信，管理端可筛选，原员工记录不被重分配", async () => {
    await write(device, "put", "/api/fan-reports", { businessDate: today, addedCount: 3 }).expect(200);
    await write(device, "post", "/api/orders", { businessDate: today, orderRef: "fixture-order-A", amount: "20.00" }).expect(201);
    device2 = await anonymous();
    ids.wxB = await register(device2, "Fixture_WeChat_B", await code({ teamId: ids.teamB }));
    await write(device2, "put", "/api/fan-reports", { businessDate: today, addedCount: 7 }).expect(200);
    await write(device2, "post", "/api/orders", { orderRef: "fixture-order-B", amount: "40.00" }).expect(201);
    await write(device2, "post", "/api/orders", { userId: ids.wxA, orderRef: "wrong-owner", amount: "1.00" }).expect(403);
    await write(device2, "put", "/api/fan-reports", { userId: ids.wxA, businessDate: today, addedCount: 9 }).expect(403);
    await device2.agent.get(`/api/orders?userId=${ids.wxA}`).expect(403);
    expect((await device2.agent.get("/api/fan-reports/me")).body.reports).toHaveLength(1);
    const orders = (await boss.agent.get(`/api/orders?userId=${ids.wxA}`).expect(200)).body.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ userId: ids.wxA, wechatId: "Fixture_WeChat_A", amount: "20.00" });
    const summary = (await boss.agent.get(`/api/fan-reports/summary?date=${today}&accountId=${ids.wxA}`).expect(200)).body.teams;
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ expectedCount: 1, totalAdded: 3 });
    expect(summary[0].details[0]).toMatchObject({ userId: ids.wxA, wechatId: "Fixture_WeChat_A", accountKind: "cs_wechat" });
    const csv = (await boss.agent.get(`/api/fan-reports/export?date=${today}&accountId=${ids.wxA}`).expect(200)).text;
    expect(csv).toContain("Fixture_WeChat_A"); expect(csv).not.toContain("Fixture_WeChat_B"); expect(csv).not.toContain("legacy");
    expect((await db.query("SELECT user_id,added_count FROM fan_reports WHERE user_id=$1", [ids.legacy])).rows[0]).toEqual({ user_id: ids.legacy, added_count: 15 });
    await expect((await login("legacy")).agent.get("/api/auth/me").then((r) => r.body.user.accountKind)).resolves.toBe("employee");
  });
  it("主管只看授权小组的微信和汇总，客服不能枚举其他微信", async () => {
    const sup = await login("supervisor");
    const accounts = (await sup.agent.get("/api/cs-accounts").expect(200)).body.accounts;
    expect(accounts.map((a: any) => a.id)).toEqual([ids.wxA]);
    expect((await sup.agent.get(`/api/fan-reports/summary?date=${today}&accountId=${ids.wxB}`).expect(200)).body.teams).toEqual([]);
    await sup.agent.get("/api/orders").expect(200);
    await write(sup, "post", "/api/cs-accounts/registration-codes", { teamId: ids.teamA }).expect(201);
    await write(sup, "post", "/api/cs-accounts/registration-codes", { teamId: ids.teamB }).expect(403);
    await device.agent.get("/api/cs-accounts").expect(403);
    await request(app).get("/api/cs-accounts").expect(401);
    await write(admin, "patch", `/api/admin/users/${ids.wxA}`, { role: "boss" }).expect(400);
    await write(admin, "post", "/api/salaries", { userId: ids.wxA, monthlyAmount: "100.00", effectiveFrom: today }).expect(403);
  });
  it("重新发码立即失效旧登录，限定原微信并保留原加粉订单和身份ID", async () => {
    const registrationCode = await code({ accountId: ids.wxA });
    await device.agent.get("/api/auth/me").expect(401);
    const next = await anonymous();
    await write(next, "post", "/api/auth/cs-device", { wechatId: "Fixture_WeChat_B", registrationCode }).expect(400);
    expect(await register(next, "Fixture_WeChat_A", registrationCode)).toBe(ids.wxA);
    device = next;
    expect((await device.agent.get("/api/orders").expect(200)).body.orders).toHaveLength(1);
    expect((await device.agent.get("/api/fan-reports/me").expect(200)).body.reports[0].addedCount).toBe(3);
    await write(admin, "post", "/api/auth/cs-device", { wechatId: "Fixture_WeChat_A", registrationCode }).expect(409);
    expect((await boss.agent.get("/api/auth/me")).body.user.role).toBe("boss");
  });
  it("停用后原登录与已发码均失效，启用后必须重新登记", async () => {
    const revoked = await code({ accountId: ids.wxA });
    await write(registrar, "put", `/api/cs-accounts/${ids.wxA}/status`, { isActive: false }).expect(200);
    const next = await anonymous();
    await write(next, "post", "/api/auth/cs-device", { wechatId: "Fixture_WeChat_A", registrationCode: revoked }).expect(400);
    await write(registrar, "post", "/api/cs-accounts/registration-codes", { accountId: ids.wxA }).expect(400);
    await write(registrar, "put", `/api/cs-accounts/${ids.wxA}/status`, { isActive: true }).expect(200);
    await device.agent.get("/api/auth/me").expect(401);
    expect(await register(next, "Fixture_WeChat_A", await code({ accountId: ids.wxA }))).toBe(ids.wxA);
    device = next;
  });
  it("同一码并发登记只有一次成功；重复微信大小写、过期码和来源校验生效", async () => {
    const registrationCode = await code();
    const [a, b] = await Promise.all([anonymous(), anonymous()]);
    const results = await Promise.all([write(a, "post", "/api/auth/cs-device", { wechatId: "Fixture_Race_A", registrationCode }), write(b, "post", "/api/auth/cs-device", { wechatId: "Fixture_Race_B", registrationCode })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const next = await anonymous();
    const duplicate = await code();
    await write(next, "post", "/api/auth/cs-device", { wechatId: "fixture_wechat_a", registrationCode: duplicate }).expect(409);
    await db.query("UPDATE cs_registration_codes SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE code_hash=$1", [registrationHash(duplicate)]);
    await write(next, "post", "/api/auth/cs-device", { wechatId: "Fixture_Expired", registrationCode: duplicate }).expect(400);
    await next.agent.post("/api/auth/cs-device").send({ wechatId: "Fixture_NoCsrf", registrationCode: await code() }).expect(403);
    await write(next, "post", "/api/auth/cs-device", { wechatId: "微信昵称", registrationCode: await code() }).expect(400);
    await write(next, "post", "/api/auth/cs-device", { wechatId: "Fixture_BadCode", registrationCode: "1234" }).expect(400);
  });
  it("发新码撤销旧码，登记与停用并发也不能留下有效登录", async () => {
    const oldCode = await code({ accountId: ids.wxA });
    const newCode = await code({ accountId: ids.wxA });
    const next = await anonymous();
    await write(next, "post", "/api/auth/cs-device", { wechatId: "Fixture_WeChat_A", registrationCode: oldCode }).expect(400);
    const results = await Promise.all([
      write(next, "post", "/api/auth/cs-device", { wechatId: "Fixture_WeChat_A", registrationCode: newCode }),
      write(registrar, "put", `/api/cs-accounts/${ids.wxA}/status`, { isActive: false })
    ]);
    expect([200, 400]).toContain(results[0].status);
    expect(results[1].status).toBe(200);
    await next.agent.get("/api/auth/me").expect(401);
    expect((await db.query("SELECT count(*)::int AS n FROM orders WHERE user_id=$1", [ids.wxA])).rows[0].n).toBe(1);
  });
  it("登记失败触发限流，并返回明确错误", async () => {
    const limitedApp = createApp(db, { ...loadConfig(), loginMaxAttempts: 1 });
    const agent = request.agent(limitedApp);
    const token = (await agent.get("/api/auth/csrf")).body.csrfToken;
    const attempt = () => agent.post("/api/auth/cs-device").set("Origin", ORIGIN).set("X-CSRF-Token", token).send({ wechatId: "Fixture_Rate", registrationCode: "bad" });
    await attempt().expect(400);
    const blocked = await attempt().expect(429);
    expect(blocked.body.error).toContain("频繁");
  });
  it("后台管理员可配置系统，但不能通过任一业务 API 读写数据", async () => {
    for (const path of ["/api/admin/users", "/api/admin/teams", "/api/admin/settings", "/api/modules"]) await admin.agent.get(path).expect(200);
    for (const path of ["/api/cs-accounts", "/api/cs-accounts/teams"]) await admin.agent.get(path).expect(403);
    await write(admin, "post", "/api/cs-accounts/registration-codes", { teamId: ids.teamA }).expect(403);
    await write(admin, "put", `/api/cs-accounts/${ids.wxA}/status`, { isActive: true }).expect(403);
    for (const path of ["/api/fan-reports/me", "/api/fan-reports/summary", "/api/fan-reports/export", "/api/orders", "/api/orders/export", "/api/ops-reports", "/api/editor-reports", "/api/editor-reports/summary", "/api/dashboard/summary", "/api/reviews", "/api/salaries", "/api/notes"]) await admin.agent.get(path).expect(403);
    for (const path of ["/api/fan-reports", "/api/ops-reports", "/api/editor-reports"]) await write(admin, "put", path, {}).expect(403);
    for (const path of ["/api/orders", "/api/reviews", "/api/salaries", "/api/notes"]) await write(admin, "post", path, {}).expect(403);
  });
  it("BOSS 可查自定义区间及全局汇总，但所有配置和业务写入被拒绝", async () => {
    const summary = (await boss.agent.get(`/api/dashboard/summary?from=${today}&to=${today}`).expect(200)).body;
    expect(summary.period).toEqual({ from: today, to: today });
    expect(summary.reviewRequired).toBe(false);
    expect(summary.metrics.revenue).toBe("60.00");
    expect(summary).not.toHaveProperty("dailyByReviewStatus");
    await boss.agent.get(`/api/dashboard/summary?from=${today}&to=invalid`).expect(400);
    await boss.agent.get("/api/admin/users").expect(403);
    for (const path of ["/api/ops-reports", "/api/editor-reports", "/api/salaries"]) await boss.agent.get(path).expect(200);
    for (const path of ["/api/admin/teams", "/api/orders", "/api/reviews", "/api/notes", "/api/salaries", "/api/cs-accounts/registration-codes"]) await write(boss, "post", path, {}).expect(403);
    for (const path of ["/api/modules", "/api/admin/settings", "/api/fan-reports", "/api/ops-reports", "/api/editor-reports"]) await write(boss, "put", path, {}).expect(403);
  });
  it("主管消费及导出严格按业务日历史小组过滤，金额与筛选一致", async () => {
    const sup = await login("supervisor");
    const response = (await sup.agent.get(`/api/orders?from=${today}&to=${today}&status=placed`).expect(200)).body;
    expect(response.orders.map((row: any) => row.userId)).toEqual([ids.wxA]);
    expect(response.totals).toEqual({ amount: "20.00", refunds: "0.00", cancelled: "0.00", turnover: "20.00", turnoverCount: 1 });
    expect((await sup.agent.get(`/api/orders?userId=${ids.wxB}`).expect(200)).body.orders).toEqual([]);
    const csv = (await sup.agent.get("/api/orders/export").expect(200)).text;
    expect(csv).toContain("fixture-order-A"); expect(csv).not.toContain("fixture-order-B");
    await sup.agent.get("/api/orders?status=bad").expect(400);
    await write(sup, "post", "/api/orders", { orderRef: "sup-must-not-write" }).expect(403);
    await write(sup, "put", "/api/fan-reports", { businessDate: today, addedCount: 1 }).expect(403);
    // Moving an account tomorrow does not expose its earlier orders to the new team.
    await db.query("UPDATE team_memberships SET end_date=$2::date WHERE user_id=$1 AND end_date IS NULL", [ids.wxB,today]);
    await db.query("INSERT INTO team_memberships(user_id,team_id,start_date) VALUES($1,$2,$3::date+1)", [ids.wxB,ids.teamA,today]);
    expect((await sup.agent.get("/api/orders").expect(200)).body.orders.map((row: any) => row.userId)).toEqual([ids.wxA]);
  });
  it("未分组主管为空权限，管理员分组和撤销即时生效", async () => {
    const sup = await login("unassigned");
    expect((await sup.agent.get("/api/orders").expect(200)).body.orders).toEqual([]);
    expect((await sup.agent.get("/api/cs-accounts").expect(200)).body.accounts).toEqual([]);
    expect((await sup.agent.get(`/api/fan-reports/summary?date=${today}`).expect(200)).body.teams).toEqual([]);
    await write(sup, "post", "/api/cs-accounts/registration-codes", { teamId: ids.teamA }).expect(403);
    await write(sup, "put", `/api/cs-accounts/${ids.wxA}/status`, { isActive: true }).expect(403);
    await write(admin, "put", `/api/admin/users/${ids.unassigned}/scopes`, { teamIds: [ids.teamA] }).expect(200);
    expect((await sup.agent.get("/api/orders").expect(200)).body.orders).toHaveLength(1);
    await write(admin, "put", `/api/admin/users/${ids.unassigned}/scopes`, { teamIds: [] }).expect(200);
    expect((await sup.agent.get("/api/orders").expect(200)).body.orders).toEqual([]);
    await write(admin, "put", `/api/admin/users/${ids.boss}/scopes`, { teamIds: [ids.teamA] }).expect(400);
  });
  it("主管能登记及更新本组微信，跨组拒绝且不使别组登录失效", async () => {
    const sup = await login("supervisor");
    await write(sup, "put", `/api/cs-accounts/${ids.wxB}/status`, { isActive: false }).expect(403);
    await write(sup, "patch", `/api/cs-accounts/${ids.wxB}`, { wechatId: "Fixture_Stolen", phoneLabel: "bad" }).expect(403);
    await write(sup, "post", "/api/cs-accounts/registration-codes", { accountId: ids.wxB }).expect(403);
    await device2.agent.get("/api/auth/me").expect(200);
    await write(sup, "put", `/api/cs-accounts/${ids.wxA}/status`, { isActive: true }).expect(200);
    const edit = await write(sup, "patch", `/api/cs-accounts/${ids.wxA}`, { wechatId: "Fixture_Renamed_A", phoneLabel: "updated-fixture" }).expect(200);
    expect(edit.body.needsRegistration).toBe(true);
    const registrationCode = (await write(sup, "post", "/api/cs-accounts/registration-codes", { accountId: ids.wxA }).expect(201)).body.code;
    const next = await anonymous();
    expect(await register(next, "Fixture_Renamed_A", registrationCode)).toBe(ids.wxA);
    expect((await next.agent.get("/api/orders").expect(200)).body.orders[0]).toMatchObject({ userId: ids.wxA, amount: "20.00", wechatId: "Fixture_Renamed_A" });
  });
  it("主管批准后旧手机保持可用，只有申请手机能启用，解绑后历史订单保留", async () => {
    const accountId = ids.wxA;
    const oldPhone = await anonymous();
    await register(oldPhone, "Fixture_Renamed_A", await code({ accountId }));
    const supervisor = await login("supervisor");
    const outsider = await login("unassigned");
    const newPhone = await login("legacy");
    const otherBrowser = await login("legacy");
    const path = "/api/cs-device-bindings";
    const action = (name: string) => path + "/" + accountId + "/" + name;
    await write(newPhone, "post", path, { accountId: ids.wxB, label: "outside-team" }).expect(403);
    await write(newPhone, "post", path, { accountId, label: "new-phone" }).expect(201);
    const [{ id: bindingId }] = (await supervisor.agent.get(path).expect(200)).body.bindings;
    expect((await outsider.agent.get(path).expect(200)).body.bindings).toEqual([]);
    await write(outsider, "post", action("approve"), { bindingId }).expect(403);
    await write(newPhone, "post", action("activate"), { bindingId }).expect(409);
    await write(supervisor, "post", action("approve"), { bindingId }).expect(200);
    await oldPhone.agent.get("/api/auth/me").expect(200);
    await write(otherBrowser, "post", action("activate"), { bindingId }).expect(403);
    const activated = await write(newPhone, "post", action("activate"), { bindingId }).expect(200);
    expect(activated.body.user.id).toBe(accountId);
    await oldPhone.agent.get("/api/auth/me").expect(401);
    expect((await newPhone.agent.get("/api/orders").expect(200)).body.orders[0].userId).toBe(accountId);
    await write(supervisor, "post", "/api/cs-accounts/registration-codes", { accountId }).expect(409);
    await write(supervisor, "post", action("unbind"), {}).expect(200);
    await newPhone.agent.get("/api/auth/me").expect(401);
    expect((await supervisor.agent.get("/api/orders").expect(200)).body.orders[0].userId).toBe(accountId);
  });
  it("正式订单跟进按历史小组授权，备注不会改变订单金额或付款状态", async () => {
    const supervisor = await login("supervisor");
    const outsider = await login("unassigned");
    const [order] = (await supervisor.agent.get("/api/orders").expect(200)).body.orders;
    const path = "/api/supervisor/order-followups";
    const input = { orderId: order.id, note: "Follow-up note", nextContactOn: today, version: 0 };
    await write(outsider, "post", path, input).expect(404);
    await write(supervisor, "post", path, input).expect(200);
    expect((await supervisor.agent.get(path).expect(200)).body.records[0]).toMatchObject({ orderId: order.id, note: input.note, nextContactOn: today, version: 1 });
    expect((await outsider.agent.get(path).expect(200)).body.records).toEqual([]);
    await write(supervisor, "post", path, input).expect(409);
    expect((await supervisor.agent.get("/api/orders").expect(200)).body.orders[0]).toMatchObject({ id: order.id, amount: order.amount, status: order.status });
  });
  it("主管咨询成本只汇总本人管理范围内的已确认日报", async () => {
    const date = today;
    const supervisor = await login("supervisor");
    const both = await login("registrar");
    const outsider = await login("unassigned");
    const path = `/api/supervisor/consultation-cost?from=${date}&to=${date}`;
    const report = async (name: string, amount: string, count: number) => (await db.query(
      "INSERT INTO ops_reports(user_id,business_date,persona_name,promo_video_count,promo_cost,spend_usd,consult_count) VALUES($1,$2,$3,0,0,$4,$5) RETURNING id",
      [ids.legacy, date, name, amount, count])).rows[0].id;
    const own = await report("scope-one", "21.50", 2);
    const shared = await report("scope-shared", "8.00", 0);
    await report("unconfirmed", "90.00", 15);
    await db.query(`INSERT INTO supervisor_consultation_sources(report_id,active_dates,team_ids)
      VALUES($1,daterange($5::date,$5::date,'[]'),ARRAY[$3::uuid]),
       ($2,daterange($5::date,$5::date,'[]'),ARRAY[$3::uuid,$4::uuid])`, [own, shared, ids.teamA, ids.teamB, date]);
    expect((await supervisor.agent.get(path).expect(200)).body.days).toEqual([{date, status:"ready", spendUsd:"21.50", consultCount:2}]);
    expect((await both.agent.get(path).expect(200)).body.days).toEqual([{date, status:"ready", spendUsd:"29.50", consultCount:2}]);
    expect((await outsider.agent.get(path).expect(200)).body.days).toEqual([{date, status:"unlinked", spendUsd:null, consultCount:null}]);
    await boss.agent.get(path).expect(403);
    await supervisor.agent.get("/api/supervisor/consultation-cost?from=2026-02-30&to=2026-03-01").expect(400);
  });
  it("本组区间进粉按日报原始小组，兼容只有总数的导入记录且区分缺报和零", async () => {
    const supervisor = await login("supervisor");
    const day = (await db.query("SELECT ($1::date - 1)::text AS d", [today])).rows[0].d;
    const blankDay = (await db.query("SELECT ($1::date - 2)::text AS d", [today])).rows[0].d;
    await db.query(`INSERT INTO fan_reports
      (user_id,team_id,business_date,page_name,added_count,valid_today,comm_invalid,ms_today,ws_today)
      VALUES ($1,$2,$4,'import',7,4,3,NULL,NULL),
        ($1,$3,$4,'other-team',50,50,0,NULL,NULL),
        ($1,$2,$4,'channels',0,2,0,1,2),
        ($1,$2,$5,'reported-zero',99,0,0,0,0)`, [ids.legacy, ids.teamA, ids.teamB, day, blankDay]);
    const get = (from: string, to: string) => supervisor.agent.get("/api/fan-reports/period-summary").query({ from, to });
    expect((await get(day, day).expect(200)).body.totalAdded).toBe(10);
    expect((await get(blankDay, blankDay).expect(200)).body.totalAdded).toBe(0);
    expect((await get(blankDay, day).expect(200)).body.totalAdded).toBe(10);
    const emptyDay = (await db.query("SELECT ($1::date - 3)::text AS d", [today])).rows[0].d;
    expect((await get(emptyDay, emptyDay).expect(200)).body.totalAdded).toBeNull();
    await get(day, blankDay).expect(400);
    await (await login("legacy")).agent.get("/api/fan-reports/period-summary").query({ from: day, to: day }).expect(403);
  });
  it("系统保留最后一个管理员，避免权限调整后无人可维护", async () => {
    await write(admin, "patch", `/api/admin/users/${ids.admin}`, { isActive: false }).expect(400);
    await write(admin, "patch", `/api/admin/users/${ids.admin}`, { role: "boss" }).expect(400);
    expect((await admin.agent.get("/api/auth/me").expect(200)).body.user.role).toBe("admin");
  });
});
