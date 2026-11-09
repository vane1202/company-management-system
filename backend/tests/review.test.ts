import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { businessToday } from "../src/lib/dates.js";
import type { Express } from "express";
import type { Pool } from "pg";
import { inspectDatabaseUrl, resolveTestDatabaseUrl } from "./safeDatabase.js";

const ORIGIN = "http://127.0.0.1:13080";
const PASSWORD = "Testpass1234";
type Agent = ReturnType<typeof request.agent>;

function rewriteDatabaseName(url: string, name: string): string {
  return url.replace(/([/])([^/?#]+)(\?.*)?$/, `$1${name}$3`);
}

describe("直接统计与旧审核记录保留", () => {
  let db: Pool;
  let app: Express;
  const ids: Record<string, string> = {};
  let today = "";
  let testUrl = "";

  beforeAll(async () => {
    const raw = resolveTestDatabaseUrl();
    const inspected = inspectDatabaseUrl(raw);
    if (inspected.name === "cms_demo" || inspected.port === "15433") {
      throw new Error("拒绝使用演示库");
    }
    testUrl = rewriteDatabaseName(raw, "cms_review_test");
    const target = inspectDatabaseUrl(testUrl);
    if (target.name !== "cms_review_test" || target.port === "15433") {
      throw new Error(`审核测试库未隔离：${target.host}:${target.port}/${target.name}`);
    }
    process.env.DATABASE_URL = testUrl;
    process.env.APP_ORIGIN = ORIGIN;
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "review-test-session-secret-not-for-production";
    process.env.FAN_REPORT_BACKFILL_DAYS = "3";
    process.env.LOGIN_MAX_ATTEMPTS = "100";
    const adminUrl = rewriteDatabaseName(raw, "postgres");
    const admin = createPool(adminUrl);
    try {
      const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'cms_review_test'");
      if (!exists.rowCount) {
        await admin.query('CREATE DATABASE cms_review_test');
      }
    } finally {
      await admin.end();
    }
    const config = loadConfig();
    db = createPool(testUrl);
    const current = await db.query("SELECT current_database() AS name");
    if (current.rows[0].name !== "cms_review_test") {
      throw new Error(`拒绝在 ${current.rows[0].name} 上运行审核测试`);
    }
    await migrate(db);
    await db.query(`
      TRUNCATE review_actions, fan_report_revisions, fan_reports, ops_reports, editor_reports, orders,
               salaries, notes, audit_logs, supervisor_scopes, team_memberships,
               teams, session, users RESTART IDENTITY CASCADE
    `);
    today = businessToday(new Date(), config.businessTimezone);
    const hash = await hashPassword(PASSWORD);
    ids.teamA = (await db.query("INSERT INTO teams (name) VALUES ('一组') RETURNING id")).rows[0].id;
    async function user(username: string, role: string) {
      const inserted = await db.query(
        `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
         VALUES ($1, $2, $3, $4, FALSE) RETURNING id`,
        [username, hash, username, role]
      );
      ids[username] = inserted.rows[0].id;
      return inserted.rows[0].id;
    }
    await user("boss", "boss");
    await user("assistant", "assistant");
    await user("assistant2", "assistant");
    await user("cs_a1", "cs");
    await user("ops1", "ops");
    await user("edit1", "editor");
    await db.query("INSERT INTO team_memberships (user_id, team_id, start_date) VALUES ($1, $2, $3)", [
      ids.cs_a1,
      ids.teamA,
      today
    ]);
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

  function write(agent: Agent, csrf: string, method: "post" | "put" | "patch", url: string) {
    return agent[method](url).set("Origin", ORIGIN).set("X-CSRF-Token", csrf);
  }


  it("助理入口关闭，不能读写业务；BOSS 也不能恢复审核", async () => {
    const asst = await login("assistant");
    for (const path of ["/api/reviews", "/api/orders", "/api/fan-reports/summary", "/api/ops-reports", "/api/salaries", "/api/dashboard/summary"]) await asst.agent.get(path).expect(403);
    await write(asst.agent, asst.csrf, "post", "/api/reviews").send({action:"approve"}).expect(403);
    const boss = await login("boss");
    await boss.agent.get("/api/reviews").expect(410);
    await write(boss.agent, boss.csrf, "post", "/api/reviews").send({action:"approve"}).expect(403);
  });
  it("新填报即时计入汇总，不创建审核动作或伪造通过记录", async () => {
    const ops = await login("ops1");
    const saved = (await write(ops.agent,ops.csrf,"put","/api/ops-reports").send({businessDate:today,platform:"direct",promoVideoCount:5,promoCost:"88.00"}).expect(200)).body.report;
    expect(saved).not.toHaveProperty("reviewStatus");
    expect(saved.recordVersion).toBe(1);
    const boss = await login("boss");
    const data = (await boss.agent.get("/api/dashboard/summary?preset=day").expect(200)).body;
    expect(data.metrics.promoCost).toBe("88.00");
    expect(data.reviewRequired).toBe(false);
    expect(data.dataCounts).toEqual({fans:0,ops:1,editor:0});
    expect(data).not.toHaveProperty("dailyByReviewStatus");
    const raw=(await db.query("SELECT reviewed_by,reviewed_at FROM ops_reports WHERE id=$1",[saved.id])).rows[0];
    expect(raw).toEqual({reviewed_by:null,reviewed_at:null});
    expect((await db.query("SELECT * FROM review_actions")).rowCount).toBe(0);
  });
  it("修改原记录直接更新统计并保留既有历史审核证据", async () => {
    const ops=await login("ops1");
    const row=(await db.query("SELECT id FROM ops_reports WHERE platform='direct'")).rows[0];
    await db.query("UPDATE ops_reports SET review_status='rejected',reviewed_by=$2,reviewed_at=now(),review_reason='历史说明' WHERE id=$1",[row.id,ids.assistant]);
    await db.query("INSERT INTO review_actions(entity_type,entity_id,review_version,action,reason,actor_id,before_status,after_status) VALUES('ops_report',$1,1,'rejected','历史说明',$2,'pending','rejected')",[row.id,ids.assistant]);
    const before=(await db.query("SELECT reviewed_by,reviewed_at,review_reason,review_status FROM ops_reports WHERE id=$1",[row.id])).rows[0];
    const saved=(await write(ops.agent,ops.csrf,"put","/api/ops-reports").send({businessDate:today,platform:"direct",promoVideoCount:6,promoCost:"90.00"}).expect(200)).body.report;
    expect(saved.recordVersion).toBe(2);
    expect((await db.query("SELECT reviewed_by,reviewed_at,review_reason,review_status FROM ops_reports WHERE id=$1",[row.id])).rows[0]).toEqual(before);
    expect((await db.query("SELECT * FROM review_actions")).rowCount).toBe(1);
    expect((await (await login("boss")).agent.get("/api/dashboard/summary")).body.metrics.promoCost).toBe("90.00");
    expect((await db.query("SELECT * FROM audit_logs WHERE entity_id=$1 AND action NOT LIKE 'review_%'",[row.id])).rowCount).toBeGreaterThan(0);
  });
  it("历史三种状态全部纳入加粉与订单，退款只扣一次", async () => {
    for (const [index,status] of ["pending","approved","rejected"].entries()) {
      await db.query("INSERT INTO orders(user_id,business_date,order_ref,amount,status,review_status) VALUES($1,$2,$3,$4,$5,$6)",[ids.cs_a1,today,"DIRECT-"+index,(index+1)+"0.00",index===2?"refunded":"placed",status]);
      await db.query("INSERT INTO fan_reports(user_id,business_date,page_name,added_count,ms_today,ws_today,review_status) VALUES($1,$2,$3,$4,$4,0,$5)",[ids.cs_a1,today,"page-"+index,index+1,status]);
    }
    const boss=await login("boss");
    const data=(await boss.agent.get("/api/dashboard/summary").expect(200)).body.metrics;
    expect(data).toMatchObject({revenue:"60.00",refunds:"30.00",orderCount:2,fanAddedTotal:6});
    expect((await boss.agent.get("/api/orders").expect(200)).body.orders).toHaveLength(3);
    const team=(await boss.agent.get("/api/fan-reports/summary?date="+today).expect(200)).body.teams[0];
    expect(team.totalAdded).toBe(6); expect(team).not.toHaveProperty("reviewCounts");
    expect(team.details[0]).not.toHaveProperty("reviewStatus");
  });
  it("旧审核筛选明确拒绝，不能静默把新总数缩为旧已通过口径", async () => {
    const boss=await login("boss");
    await boss.agent.get("/api/dashboard/summary?reviewStatus=approved").expect(400);
    await boss.agent.get("/api/orders?reviewStatus=pending").expect(400);
  });
});
