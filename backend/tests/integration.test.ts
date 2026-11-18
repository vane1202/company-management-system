import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { addDays, businessToday, daysInMonth, startOfMonth, startOfWeekMonday } from "../src/lib/dates.js";
import type { Express } from "express";
import type { Pool } from "pg";
import { resolveTestDatabaseUrl } from "./safeDatabase.js";

const ORIGIN = "http://127.0.0.1:13080";
const PASSWORD = "Testpass1234";

type Agent = ReturnType<typeof request.agent>;

describe("公司内部管理系统集成测试", () => {
  let db: Pool;
  let app: Express;
  const ids: Record<string, string> = {};
  let today = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    process.env.APP_ORIGIN = ORIGIN;
    process.env.FAN_REPORT_BACKFILL_DAYS = "3";
    process.env.LOGIN_MAX_ATTEMPTS = "100";
    const config = loadConfig();
    db = createPool(config.databaseUrl);
    await migrate(db);
    await db.query(`
      TRUNCATE review_actions, fan_report_revisions, fan_reports, ops_reports, editor_reports, orders,
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
    await user("admin", "admin");
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

  it("主管只能看负责组的加粉与订单，不能跨组或看工资", async () => {
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
    await sup.agent.get("/api/orders").expect(200);
    await sup.agent.get("/api/dashboard/summary").expect(403);

    const exportRes = await sup.agent.get(`/api/fan-reports/export?date=${today}`).expect(200);
    expect(exportRes.text).toContain("一组");
    expect(exportRes.text).not.toContain("二组");
    expect(exportRes.text).not.toContain("月基本工资");
  });

  it("跨组需要显式授权后才能查看", async () => {
    const boss = await login("admin");
    await write(boss.agent, boss.csrf, "post", `/api/admin/users/${ids.sup_a}/scopes`)
      .send({ teamId: ids.teamB, crossGrant: true })
      .expect(201);
    const sup = await login("sup_a");
    const summary = await sup.agent.get(`/api/fan-reports/summary?date=${today}&teamId=${ids.teamB}`).expect(200);
    expect(summary.body.teams[0].teamName).toBe("二组");
  });

  it("补报窗口由服务端强制，主管只读不能代为更正", async () => {
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
      .expect(403);
  });

  it("调组不改写历史加粉归属", async () => {
    const hist = addDays(today, -1);
    const cs = await login("cs_a1");
    await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 7, businessDate: hist })
      .expect(200);

    const boss = await login("admin");
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
    // Seed existing payroll through the isolated fixture: neither new admin nor BOSS may write payroll.
    await db.query("INSERT INTO salaries(user_id,monthly_amount,effective_from,created_by) VALUES($1,3000,$2,$3)", [ids.ops1,addDays(today,-5),ids.admin]);
    const data = await boss.agent.get("/api/dashboard/summary?preset=day").expect(200);
    expect(data.body.metrics.revenue).toBe("130.50");
    expect(data.body.metrics.refunds).toBe("30.00");
    expect(data.body.metrics.promoCost).toBe("88.00");
    expect(data.body.metrics.customProductCost).toBe("20.00");
    expect(data.body.metrics.laborCost).toBe("5.00");
    expect(data.body.metrics.shippingCost).toBe("2.50");
    expect(data.body.metrics.salaryAllocated).toBe((300000n / BigInt(daysInMonth(today)) / 100n).toString() + "." + (300000n / BigInt(daysInMonth(today)) % 100n).toString().padStart(2, "0"));
    if (daysInMonth(today) === 30) {
      expect(data.body.metrics.salaryAllocated).toBe("100.00");
      expect(data.body.metrics.estimate).toBe("-115.00");
    }
    const listed = await boss.agent.get(`/api/orders?from=${today}&to=${today}`).expect(200);
    const grossCents = listed.body.orders.reduce(
      (sum: number, item: { amount: string }) => sum + Math.round(Number(item.amount) * 100),
      0
    );
    const refundCents = listed.body.orders
      .filter((item: { status: string }) => item.status === "refunded")
      .reduce((sum: number, item: { amount: string }) => sum + Math.round(Number(item.amount) * 100), 0);
    expect((grossCents / 100).toFixed(2)).toBe(data.body.metrics.revenue);
    expect((refundCents / 100).toFixed(2)).toBe(data.body.metrics.refunds);
    expect(data.body.disclaimer).toContain("不等于会计净利润");
    expect(data.body.metrics.endingInventory).toBe(13);
  });


  it("登录和 /me 会返回东八区业务日，日期读写保持 YYYY-MM-DD", async () => {
    const cs = await login("cs_a1");
    const me = await cs.agent.get("/api/auth/me").expect(200);
    expect(me.body.today).toBe(today);
    expect(me.body.timezone).toBe("Asia/Shanghai");
    const orders = await cs.agent.get("/api/orders").expect(200);
    const ord1 = orders.body.orders.find((item: { orderRef: string }) => item.orderRef === "ORD-1");
    expect(ord1.businessDate).toBe(today);
    const boss = await login("boss");
    const salaries = await boss.agent.get("/api/salaries").expect(200);
    const row = salaries.body.salaries.find((item: { userId: string }) => item.userId === ids.ops1);
    expect(row.effectiveFrom).toBe(addDays(today, -5));
  });

  it("Boss 未指定 userId 时能看到他人的推广和拍剪明细，且日期不偏移", async () => {
    const boss = await login("boss");
    const ops = await boss.agent.get("/api/ops-reports").expect(200);
    expect(ops.body.reports.length).toBeGreaterThan(0);
    expect(ops.body.reports[0].businessDate).toBe(today);
    const editor = await boss.agent.get("/api/editor-reports").expect(200);
    const todayRow = editor.body.reports.find((item: { businessDate: string }) => item.businessDate === today);
    expect(todayRow).toBeTruthy();
    expect(todayRow.shootCount).toBe(3);
  });

  it("经营估算日周月边界正确", async () => {
    const boss = await login("boss");
    const day = await boss.agent.get("/api/dashboard/summary?preset=day").expect(200);
    expect(day.body.period).toEqual({ from: today, to: today });
    const week = await boss.agent.get("/api/dashboard/summary?preset=week").expect(200);
    expect(week.body.period).toEqual({ from: startOfWeekMonday(today), to: today });
    const month = await boss.agent.get("/api/dashboard/summary?preset=month").expect(200);
    expect(month.body.period).toEqual({ from: startOfMonth(today), to: today });
  });

  it("退款源订单计入收入后再减去退款，避免双扣", async () => {
    const cs = await login("cs_a1");
    const listed = await cs.agent.get("/api/orders").expect(200);
    const ord1 = listed.body.orders.find((item: { orderRef: string }) => item.orderRef === "ORD-1");
    expect(ord1).toBeTruthy();
    await write(cs.agent, cs.csrf, "patch", `/api/orders/${ord1.id}`).send({
      businessDate: today,
      orderRef: "ORD-1",
      amount: "100.50",
      customProductCost: "20.00",
      laborCost: "5.00",
      shippingCost: "2.50",
      status: "refunded"
    }).expect(200);

    const boss = await login("boss");
    const after = await boss.agent.get("/api/dashboard/summary?preset=day").expect(200);
    expect(after.body.metrics.revenue).toBe("130.50");
    expect(after.body.metrics.refunds).toBe("130.50");
  });

  it("员工和主管不能修改编制、工资或把自己改成 Boss", async () => {
    const cs = await login("cs_a1");
    await write(cs.agent, cs.csrf, "post", "/api/admin/users")
      .send({ username: "hacker2", password: PASSWORD, displayName: "x", role: "cs" })
      .expect(403);
    await write(cs.agent, cs.csrf, "patch", `/api/admin/users/${ids.cs_a1}`)
      .send({ role: "boss" })
      .expect(403);
    await write(cs.agent, cs.csrf, "post", `/api/admin/users/${ids.cs_a1}/transfer`)
      .send({ teamId: ids.teamA, effectiveDate: today })
      .expect(403);
    const sup = await login("sup_a");
    await write(sup.agent, sup.csrf, "post", "/api/salaries")
      .send({ userId: ids.cs_a1, monthlyAmount: "1000.00", effectiveFrom: today })
      .expect(403);
    await write(sup.agent, sup.csrf, "patch", `/api/admin/users/${ids.sup_a}`)
      .send({ role: "boss" })
      .expect(403);
    await write(sup.agent, sup.csrf, "post", "/api/admin/teams")
      .send({ name: "越权组" })
      .expect(403);
  });

  it("停用账号不改写历史应报，且导出人员与汇总一致", async () => {
    const hist = addDays(today, -1);
    const boss = await login("admin");
    await write(boss.agent, boss.csrf, "patch", `/api/admin/users/${ids.cs_a2}`)
      .send({ isActive: false })
      .expect(200);
    const sup = await login("sup_a");
    const summary = await sup.agent.get(`/api/fan-reports/summary?date=${hist}`).expect(200);
    const names = summary.body.teams[0].details.map((item: { displayName: string }) => item.displayName);
    expect(names).toContain("cs_a2");
    const exportRes = await sup.agent.get(`/api/fan-reports/export?date=${hist}`).expect(200);
    expect(exportRes.text).toContain("cs_a2");
    for (const item of summary.body.teams[0].details) {
      expect(exportRes.text).toContain(item.displayName);
      expect(exportRes.text).toContain(item.username);
    }
    await write(boss.agent, boss.csrf, "patch", `/api/admin/users/${ids.cs_a2}`)
      .send({ isActive: true })
      .expect(200);
  });

  it("后台设置的补报窗口对员工生效", async () => {
    const boss = await login("admin");
    await write(boss.agent, boss.csrf, "put", "/api/admin/settings")
      .send({ fan_report_backfill_days: 1 })
      .expect(200);
    const cs = await login("cs_a2");
    await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 2, businessDate: addDays(today, -1) })
      .expect(403);
    await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 2, businessDate: today })
      .expect(200);
    await write(boss.agent, boss.csrf, "put", "/api/admin/settings")
      .send({ fan_report_backfill_days: 3 })
      .expect(200);
  });

  it("同一员工工资生效区间不能重叠", async () => {
    await expect(db.query("INSERT INTO salaries(user_id,monthly_amount,effective_from,created_by) VALUES($1,1000,$2,$3)", [ids.ops1,today,ids.admin])).rejects.toMatchObject({ code: "23P01" });
  });

  it("首次登录未改密时不能填报", async () => {
    const fresh = await login("fresh");
    await write(fresh.agent, fresh.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 1, businessDate: today })
      .expect(403);
  });

  it("三部门提交后能读回本人数据，且不会串到他人", async () => {
    const cs = await login("cs_a2");
    const fan = await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 3, businessDate: today })
      .expect(200);
    expect(fan.body.report.userId).toBe(ids.cs_a2);
    expect(fan.body.report.addedCount).toBe(3);
    const mine = await cs.agent.get("/api/fan-reports/me").expect(200);
    expect(mine.body.reports.every((item: { userId: string }) => item.userId === ids.cs_a2)).toBe(true);

    const order = await write(cs.agent, cs.csrf, "post", "/api/orders")
      .send({
        businessDate: today,
        orderRef: "ORD-OWN-A2",
        amount: "12.00",
        status: "placed"
      })
      .expect(201);
    expect(order.body.order.orderRef).toBe("ORD-OWN-A2");
    const orders = await cs.agent.get("/api/orders").expect(200);
    expect(orders.body.orders.some((item: { orderRef: string }) => item.orderRef === "ORD-OWN-A2")).toBe(true);
    expect(orders.body.orders.some((item: { orderRef: string }) => item.orderRef === "ORD-1")).toBe(false);

    const ops = await login("ops1");
    const opsList = await ops.agent.get("/api/ops-reports").expect(200);
    expect(opsList.body.reports.length).toBeGreaterThan(0);
    expect(opsList.body.reports.every((item: { userId: string }) => item.userId === ids.ops1)).toBe(true);
    const promo = opsList.body.reports.find((item: { platform: string }) => item.platform === "账户A");
    expect(promo.promoVideoCount).toBe(5);
    expect(promo.promoCost).toBe("88.00");

    const editor = await login("edit1");
    const editorList = await editor.agent.get("/api/editor-reports").expect(200);
    expect(editorList.body.reports.every((item: { userId: string }) => item.userId === ids.edit1)).toBe(true);
    const todayRow = editorList.body.reports.find((item: { businessDate: string }) => item.businessDate === today);
    expect(todayRow.shootCount).toBe(3);
    expect(todayRow.finishedCount).toBe(4);
    expect(todayRow.inventorySnapshot).toBe(13);
  });

  it("主管不能代报未授权组，本人填报仍受补报窗口限制", async () => {
    const hash = await hashPassword(PASSWORD);
    const teamC = await db.query("INSERT INTO teams (name) VALUES ('三组') RETURNING id");
    const csC = await db.query(
      `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
       VALUES ('cs_c1', $1, 'cs_c1', 'cs', FALSE) RETURNING id`,
      [hash]
    );
    ids.teamC = teamC.rows[0].id;
    ids.cs_c1 = csC.rows[0].id;
    await db.query("INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)", [
      ids.cs_c1,
      ids.teamC,
      addDays(today, -10)
    ]);

    const sup = await login("sup_a");
    await sup.agent.get(`/api/fan-reports/summary?date=${today}&teamId=${ids.teamC}`).expect(403);
    await write(sup.agent, sup.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 6, businessDate: today, userId: ids.cs_c1 })
      .expect(403);

    const ownOld = addDays(today, -3);
    await write(sup.agent, sup.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 1, businessDate: ownOld })
      .expect(403);
  });

  it("Boss 与主管导出 CSV 的人员和加粉数与汇总一致", async () => {
    const boss = await login("boss");
    const summary = await boss.agent.get(`/api/fan-reports/summary?date=${today}`).expect(200);
    const exported = await boss.agent.get(`/api/fan-reports/export?date=${today}`).expect(200);
    const lines = String(exported.text).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    expect(lines[0]).toBe("业务日,小组,姓名,登录名,加粉数,状态");
    let detailCount = 0;
    for (const team of summary.body.teams) {
      for (const item of team.details) {
        detailCount += 1;
        const status = item.status === "reported" ? "已报" : "未报";
        const count = item.addedCount === null ? "" : String(item.addedCount);
        const match = lines.find((line: string) => line.split(",")[3] === item.username && line.includes(team.teamName));
        expect(match).toBeTruthy();
        expect(match).toContain(`,${count},${status}`);
      }
    }
    expect(lines.length - 1).toBe(detailCount);

    const sup = await login("sup_a");
    const supSummary = await sup.agent.get(`/api/fan-reports/summary?date=${today}`).expect(200);
    const supExport = await sup.agent.get(`/api/fan-reports/export?date=${today}`).expect(200);
    expect(supExport.text).not.toContain("三组");
    for (const team of supSummary.body.teams) {
      expect(team.teamName).not.toBe("三组");
      for (const item of team.details) {
        expect(supExport.text).toContain(item.username);
      }
    }
  });

  it("健康检查可用", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
  });

  it("登录限流对大小写和首尾空白标准化一致，支持 IP 总量限流与代理隔离", async () => {
    const limitedApp = createApp(db, {
      ...loadConfig(),
      trustProxy: 1,
      loginMaxAttempts: 2,
      loginIpMaxAttempts: 4
    });

    const agent = request.agent(limitedApp);
    const csrf = (await agent.get("/api/auth/csrf")).body.csrfToken;
    const failAttempt = (username: string, ip = "203.0.113.10") =>
      agent
        .post("/api/auth/login")
        .set("Origin", ORIGIN)
        .set("X-CSRF-Token", csrf)
        .set("X-Forwarded-For", ip)
        .send({ username, password: "WrongPassword123" });

    await failAttempt("missing_user").expect(401);
    await failAttempt("  MISSING_USER \t").expect(401);
    await failAttempt(" missing_user").expect(429);

    // 同一代理 IP 更换不同用户名继续失败，也会在达到 IP 上限后触发 429
    const ipAgent = request.agent(limitedApp);
    const ipCsrf = (await ipAgent.get("/api/auth/csrf")).body.csrfToken;
    const ipFail = (username: string) =>
      ipAgent
        .post("/api/auth/login")
        .set("Origin", ORIGIN)
        .set("X-CSRF-Token", ipCsrf)
        .set("X-Forwarded-For", "203.0.113.20")
        .send({ username, password: "WrongPassword123" });
    await ipFail("acct_1").expect(401);
    await ipFail("acct_2").expect(401);
    await ipFail("acct_3").expect(401);
    await ipFail("acct_4").expect(401);
    await ipFail("acct_5").expect(429);

    // 不同客户端 IP 不受前面 IP 失败计数影响，且成功登录不被计入失败配额
    const cleanAgent = request.agent(limitedApp);
    const cleanCsrf = (await cleanAgent.get("/api/auth/csrf")).body.csrfToken;
    await cleanAgent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", cleanCsrf)
      .set("X-Forwarded-For", "203.0.113.30")
      .send({ username: "  OPS1 ", password: PASSWORD })
      .expect(200);
  });

  it("管理员重置密码与强制下线、修改密码及停用/改角色均立即撤销旧会话", async () => {
    const admin = await login("admin");
    const created = await write(admin.agent, admin.csrf, "post", "/api/admin/users")
      .send({ username: "reset_target", displayName: "待重置员工", password: PASSWORD, role: "ops" })
      .expect(201);
    const targetId = created.body.user.id as string;

    // 首次登录后改密
    const s1 = await login("reset_target");
    const s2 = await login("reset_target");
    await write(s1.agent, s1.csrf, "post", "/api/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "UpdatedPass1234" })
      .expect(200);
    // 当前会话保留，另一设备旧会话立即失效
    await s1.agent.get("/api/ops-reports").expect(200);
    await s2.agent.get("/api/auth/me").expect(401);

    // 管理员强制下线
    await write(admin.agent, admin.csrf, "post", `/api/admin/users/${targetId}/revoke-sessions`).send({}).expect(200);
    await s1.agent.get("/api/auth/me").expect(401);

    // 不能通过管理接口重置或强制下线自己
    await write(admin.agent, admin.csrf, "post", `/api/admin/users/${ids.admin}/reset-password`)
      .send({ generate: true })
      .expect(400);
    await write(admin.agent, admin.csrf, "post", `/api/admin/users/${ids.admin}/revoke-sessions`)
      .send({})
      .expect(400);

    // 重新登录后管理员重置密码（自动生成临时密码），现有会话失效，旧密码失效，新临时密码登录后强制改密
    const s3Agent = request.agent(app);
    const s3Csrf = (await s3Agent.get("/api/auth/csrf")).body.csrfToken;
    const s3Login = await s3Agent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", s3Csrf)
      .send({ username: "reset_target", password: "UpdatedPass1234" })
      .expect(200);
    const s3Token = s3Login.body.csrfToken;
    await s3Agent.get("/api/ops-reports").expect(200);

    const resetRes = await write(admin.agent, admin.csrf, "post", `/api/admin/users/${targetId}/reset-password`)
      .send({ generate: true })
      .expect(200);
    expect(resetRes.headers["cache-control"]).toBe("no-store");
    expect(resetRes.body.mustChangePassword).toBe(true);
    const tempPass = resetRes.body.temporaryPassword as string;
    expect(tempPass.length).toBeGreaterThanOrEqual(10);

    // 旧会话已立即失效
    await s3Agent.get("/api/auth/me").expect(401);
    // 审计日志不记录明文临时密码
    const auditRows = await db.query(
      "SELECT after_data::text AS after_text FROM audit_logs WHERE entity_id = $1 AND action = 'user_password_reset'",
      [targetId]
    );
    expect(auditRows.rowCount).toBe(1);
    expect(auditRows.rows[0].after_text).not.toContain(tempPass);

    // 使用临时密码登录，必须先改密才能访问业务接口
    const tempAgent = request.agent(app);
    const tempCsrf = (await tempAgent.get("/api/auth/csrf")).body.csrfToken;
    const tempLogin = await tempAgent
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", tempCsrf)
      .send({ username: "reset_target", password: tempPass })
      .expect(200);
    expect(tempLogin.body.user.mustChangePassword).toBe(true);
    await tempAgent.get("/api/ops-reports").expect(403);

    await write(tempAgent, tempLogin.body.csrfToken, "post", "/api/auth/change-password")
      .send({ currentPassword: tempPass, newPassword: "FinalPass12345" })
      .expect(200);
    await tempAgent.get("/api/ops-reports").expect(200);

    // 变更角色会立即撤销现有会话
    await write(admin.agent, admin.csrf, "patch", `/api/admin/users/${targetId}`)
      .send({ role: "editor" })
      .expect(200);
    await tempAgent.get("/api/auth/me").expect(401);
    expect(s3Token).toBeTruthy();
  });
});
