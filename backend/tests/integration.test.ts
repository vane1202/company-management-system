import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { addDays, businessToday, daysInMonth } from "../src/lib/dates.js";
import type { Express } from "express";
import type { Pool } from "pg";

const ORIGIN = "http://127.0.0.1:13080";
const PASSWORD = "Testpass1234";

type Agent = ReturnType<typeof request.agent>;

describe("公司内部管理系统集成测试", () => {
  let db: Pool;
  let app: Express;
  const ids: Record<string, string> = {};
  let today = "";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("未设置 DATABASE_URL，无法运行集成测试");
    }
    process.env.APP_ORIGIN = ORIGIN;
    process.env.FAN_REPORT_BACKFILL_DAYS = "3";
    process.env.LOGIN_MAX_ATTEMPTS = "8";
    const config = loadConfig();
    db = createPool(config.databaseUrl);
    await migrate(db);
    await db.query(`
      TRUNCATE fan_report_revisions, fan_reports, ops_reports, editor_reports, orders,
               salaries, notes, audit_logs, supervisor_scopes, team_memberships,
               teams, session, users RESTART IDENTITY CASCADE
    `);
    today = businessToday(new Date(), config.businessTimezone);
    const hash = await hashPassword(PASSWORD);
    const teamA = await db.query("INSERT INTO teams (name) VALUES ('一组') RETURNING id");
    const teamB = await db.query("INSERT INTO teams (name) VALUES ('二组') RETURNING id");
    ids.teamA = teamA.rows[0].id;
    ids.teamB = teamB.rows[0].id;

    async function user(username: string, role: string, extra: { mustChange?: boolean } = {}) {
      const inserted = await db.query(
        `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [username, hash, username, role, extra.mustChange ?? false]
      );
      ids[username] = inserted.rows[0].id;
      return inserted.rows[0].id;
    }

    await user("boss", "boss");
    await user("sup_a", "cs_supervisor");
    await user("sup_b", "cs_supervisor");
    await user("cs_a1", "cs");
    await user("cs_a2", "cs");
    await user("cs_b1", "cs");
    await user("ops1", "ops");
    await user("edit1", "editor");
    await user("fresh", "cs", { mustChange: true });

    const start = addDays(today, -10);
    for (const [userKey, teamKey] of [
      ["cs_a1", "teamA"],
      ["cs_a2", "teamA"],
      ["cs_b1", "teamB"],
      ["fresh", "teamA"]
    ] as const) {
      await db.query(
        "INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)",
        [ids[userKey], ids[teamKey], start]
      );
    }
    await db.query(
      "INSERT INTO supervisor_scopes (supervisor_id, team_id, is_explicit_cross_grant) VALUES ($1, $2, FALSE), ($3, $4, FALSE)",
      [ids.sup_a, ids.teamA, ids.sup_b, ids.teamB]
    );
    app = createApp(db, config);
  });

  afterAll(async () => {
    await db?.end();
  });

  async function login(username: string): Promise<{ agent: Agent; csrf: string }> {
    const agent = request.agent(app);
    const csrfRes = await agent.get("/api/auth/csrf").expect(200);
    const loginRes = await agent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", csrfRes.body.csrfToken)
      .send({ username, password: PASSWORD })
      .expect(200);
    return { agent, csrf: loginRes.body.csrfToken };
  }

  function write(agent: Agent, csrf: string, method: "post" | "put" | "patch" | "delete", url: string) {
    return agent[method](url).set("Origin", ORIGIN).set("X-CSRF-Token", csrf);
  }

  it("没有开放注册接口", async () => {
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/auth/csrf")).body.csrfToken;
    await agent
      .post("/api/admin/users")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", csrf)
      .send({ username: "hacker", password: PASSWORD, displayName: "x", role: "cs" })
      .expect(401);
  });

  it("错误密码不能登录", async () => {
    const agent = request.agent(app);
    const csrf = (await agent.get("/api/auth/csrf")).body.csrfToken;
    await agent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", csrf)
      .send({ username: "boss", password: "wrong-password" })
      .expect(401);
  });

  it("缺少 CSRF 或错误 Origin 的写入会被拒绝", async () => {
    const { agent, csrf } = await login("cs_a1");
    await agent
      .put("/api/fan-reports")
      .set("Origin", ORIGIN)
      .send({ addedCount: 1 })
      .expect(403);
    await agent
      .put("/api/fan-reports")
      .set("Origin", "http://evil.example")
      .set("X-CSRF-Token", csrf)
      .send({ addedCount: 1 })
      .expect(403);
  });

  it("客服可填报、重报覆盖留痕，且 0 与未报不同", async () => {
    const a1 = await login("cs_a1");
    await write(a1.agent, a1.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 12, businessDate: today })
      .expect(200);
    const again = await write(a1.agent, a1.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 15, businessDate: today })
      .expect(200);
    expect(again.body.revised).toBe(true);
    expect(again.body.report.addedCount).toBe(15);

    const a2 = await login("cs_a2");
    await write(a2.agent, a2.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 0, businessDate: today })
      .expect(200);

    const mine = await a1.agent.get("/api/fan-reports/me").expect(200);
    expect(mine.body.reports).toHaveLength(1);
    expect(mine.body.reports[0].addedCount).toBe(15);

    const revisions = await a1.agent.get(`/api/fan-reports/${again.body.report.id}/revisions`).expect(200);
    expect(revisions.body.revisions[0].previousCount).toBe(12);
    expect(revisions.body.revisions[0].newCount).toBe(15);
  });

  it("客服不能看汇总，也不能用 URL 改看他人数据", async () => {
    const cs = await login("cs_a1");
    await cs.agent.get("/api/fan-reports/summary").expect(403);
    await cs.agent.get("/api/fan-reports/export").expect(403);
    await cs.agent.get(`/api/ops-reports?userId=${ids.ops1}`).expect(403);
    await cs.agent.get("/api/salaries").expect(403);
    await cs.agent.get("/api/dashboard/summary").expect(403);
    await cs.agent.get(`/api/orders?userId=${ids.cs_b1}`).expect(403);
  });

  it("主管只能看负责组，不能跨组，也不能看工资和订单", async () => {
    const sup = await login("sup_a");
    const summary = await sup.agent.get(`/api/fan-reports/summary?date=${today}`).expect(200);
    expect(summary.body.teams).toHaveLength(1);
    expect(summary.body.teams[0].teamName).toBe("一组");
    expect(summary.body.teams[0].totalAdded).toBe(15);
    expect(summary.body.teams[0].expectedCount).toBe(3);
    expect(summary.body.teams[0].reportedCount).toBe(2);
    expect(summary.body.teams[0].missingCount).toBe(1);
    const missingNames = summary.body.teams[0].missing.map((item: { displayName: string }) => item.displayName);
    expect(missingNames).toContain("fresh");
    const zero = summary.body.teams[0].details.find((item: { displayName: string }) => item.displayName === "cs_a2");
    expect(zero.addedCount).toBe(0);
    expect(zero.status).toBe("reported");

    await sup.agent.get(`/api/fan-reports/summary?date=${today}&teamId=${ids.teamB}`).expect(403);
    await sup.agent.get("/api/salaries").expect(403);
    await sup.agent.get("/api/orders").expect(403);
    await sup.agent.get("/api/dashboard/summary").expect(403);

    const exportRes = await sup.agent.get(`/api/fan-reports/export?date=${today}`).expect(200);
    expect(exportRes.text).toContain("一组");
    expect(exportRes.text).not.toContain("二组");
    expect(exportRes.text).not.toContain("月基本工资");
  });

  it("跨组需要显式授权后才能查看", async () => {
    const boss = await login("boss");
    await write(boss.agent, boss.csrf, "post", `/api/admin/users/${ids.sup_a}/scopes`)
      .send({ teamId: ids.teamB, crossGrant: true })
      .expect(201);
    const sup = await login("sup_a");
    const summary = await sup.agent.get(`/api/fan-reports/summary?date=${today}&teamId=${ids.teamB}`).expect(200);
    expect(summary.body.teams[0].teamName).toBe("二组");
  });

  it("补报窗口由服务端强制，主管可在范围内代为更正", async () => {
    const oldDate = addDays(today, -3);
    const cs = await login("cs_a1");
    await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 9, businessDate: oldDate })
      .expect(403);

    const recent = addDays(today, -2);
    await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 4, businessDate: recent })
      .expect(200);

    const sup = await login("sup_a");
    await write(sup.agent, sup.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 8, businessDate: oldDate, userId: ids.cs_a1 })
      .expect(200);
  });

  it("调组不改写历史加粉归属", async () => {
    const hist = addDays(today, -1);
    const cs = await login("cs_a1");
    await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 7, businessDate: hist })
      .expect(200);

    const boss = await login("boss");
    await write(boss.agent, boss.csrf, "post", `/api/admin/users/${ids.cs_a1}/transfer`)
      .send({ teamId: ids.teamB, effectiveDate: today })
      .expect(200);

    const supA = await login("sup_a");
    const oldSummary = await supA.agent.get(`/api/fan-reports/summary?date=${hist}`).expect(200);
    const names = oldSummary.body.teams[0].details.map((item: { displayName: string }) => item.displayName);
    expect(names).toContain("cs_a1");
    const row = oldSummary.body.teams[0].details.find((item: { displayName: string }) => item.displayName === "cs_a1");
    expect(row.addedCount).toBe(7);
  });

  it("金额必须非负且精确，订单标识防重复，退款不计收入", async () => {
    const cs = await login("cs_a1");
    await write(cs.agent, cs.csrf, "post", "/api/orders")
      .send({
        businessDate: today,
        orderRef: "ORD-1",
        amount: "100.50",
        customProductCost: "20.00",
        laborCost: "5.00",
        shippingCost: "2.50",
        status: "placed"
      })
      .expect(201);
    await write(cs.agent, cs.csrf, "post", "/api/orders")
      .send({
        businessDate: today,
        orderRef: "ORD-1",
        amount: "10.00"
      })
      .expect(409);
    await write(cs.agent, cs.csrf, "post", "/api/orders")
      .send({
        businessDate: today,
        orderRef: "ORD-2",
        amount: "-1.00"
      })
      .expect(400);
    await write(cs.agent, cs.csrf, "post", "/api/orders")
      .send({
        businessDate: today,
        orderRef: "ORD-3",
        amount: 10.2
      })
      .expect(400);
    await write(cs.agent, cs.csrf, "post", "/api/orders")
      .send({
        businessDate: today,
        orderRef: "ORD-REF",
        amount: "30.00",
        status: "refunded"
      })
      .expect(201);
  });

  it("拍剪囤量按期末快照统计，不会把库存当产量加总", async () => {
    const editor = await login("edit1");
    const yesterday = addDays(today, -1);
    await write(editor.agent, editor.csrf, "put", "/api/editor-reports")
      .send({
        businessDate: yesterday,
        shootCount: 1,
        finishedCount: 2,
        publishedCount: 0,
        inventorySnapshot: 10
      })
      .expect(200);
    await write(editor.agent, editor.csrf, "put", "/api/editor-reports")
      .send({
        businessDate: today,
        shootCount: 3,
        finishedCount: 4,
        publishedCount: 1,
        inventorySnapshot: 13
      })
      .expect(200);
    const summary = await editor.agent
      .get(`/api/editor-reports/summary?from=${yesterday}&to=${today}`)
      .expect(200);
    expect(summary.body.shootCount).toBe(4);
    expect(summary.body.finishedCount).toBe(6);
    expect(summary.body.publishedCount).toBe(1);
    expect(summary.body.endingInventory).toBe(13);
  });

  it("运营可写本人推广数据，他人不可看", async () => {
    const ops = await login("ops1");
    await write(ops.agent, ops.csrf, "put", "/api/ops-reports")
      .send({
        businessDate: today,
        platform: "账户A",
        promoVideoCount: 5,
        promoCost: "88.00"
      })
      .expect(200);
    const cs = await login("cs_a2");
    await cs.agent.get(`/api/ops-reports?userId=${ids.ops1}`).expect(403);
  });

  it("Boss 可看全局估算，工资按月薪分摊而不是每天整额累加", async () => {
    const boss = await login("boss");
    await write(boss.agent, boss.csrf, "post", "/api/salaries")
      .send({
        userId: ids.ops1,
        monthlyAmount: "3000.00",
        effectiveFrom: addDays(today, -5)
      })
      .expect(201);
    const data = await boss.agent.get("/api/dashboard/summary?preset=day").expect(200);
    expect(data.body.metrics.revenue).toBe("100.50");
    expect(data.body.metrics.refunds).toBe("30.00");
    expect(data.body.metrics.promoCost).toBe("88.00");
    expect(data.body.metrics.customProductCost).toBe("20.00");
    expect(data.body.metrics.laborCost).toBe("5.00");
    expect(data.body.metrics.shippingCost).toBe("2.50");
    expect(data.body.metrics.salaryAllocated).toBe((300000n / BigInt(daysInMonth(today)) / 100n).toString() + "." + (300000n / BigInt(daysInMonth(today)) % 100n).toString().padStart(2, "0"));
    if (daysInMonth(today) === 30) {
      expect(data.body.metrics.salaryAllocated).toBe("100.00");
      expect(data.body.metrics.estimate).toBe("-145.00");
    }
    expect(data.body.disclaimer).toContain("不等于会计净利润");
    expect(data.body.metrics.endingInventory).toBe(13);
  });

  it("首次登录未改密时不能填报", async () => {
    const fresh = await login("fresh");
    await write(fresh.agent, fresh.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 1, businessDate: today })
      .expect(403);
  });

  it("健康检查可用", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
  });
});
