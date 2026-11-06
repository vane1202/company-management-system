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

describe("助理审核流程", () => {
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

  it("助理不能查看工资或经营估算，也不能改业务值或管理编制", async () => {
    const asst = await login("assistant");
    await asst.agent.get("/api/salaries").expect(403);
    await asst.agent.get("/api/dashboard/summary?preset=day").expect(403);
    await write(asst.agent, asst.csrf, "post", "/api/salaries")
      .send({ userId: ids.cs_a1, monthlyAmount: "1000.00", effectiveFrom: today })
      .expect(403);
    await write(asst.agent, asst.csrf, "put", "/api/ops-reports")
      .send({ businessDate: today, platform: "X", promoVideoCount: 1, promoCost: "1.00" })
      .expect(403);
    await write(asst.agent, asst.csrf, "put", "/api/editor-reports")
      .send({
        businessDate: today,
        shootCount: 1,
        finishedCount: 1,
        publishedCount: 0,
        inventorySnapshot: 1
      })
      .expect(403);
    await write(asst.agent, asst.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 1, businessDate: today })
      .expect(403);
    await write(asst.agent, asst.csrf, "post", "/api/orders")
      .send({ businessDate: today, orderRef: "NOPE", amount: "1.00", status: "placed" })
      .expect(403);
    await write(asst.agent, asst.csrf, "post", "/api/admin/users")
      .send({ username: "hacker3", password: PASSWORD, displayName: "x", role: "boss" })
      .expect(403);
    await write(asst.agent, asst.csrf, "patch", `/api/admin/users/${ids.cs_a1}`)
      .send({ role: "boss" })
      .expect(403);
  });

  it("员工不能越权审核，提交后为待审；助理可退回并留原因", async () => {
    const ops = await login("ops1");
    const saved = await write(ops.agent, ops.csrf, "put", "/api/ops-reports")
      .send({ businessDate: today, platform: "账户A", promoVideoCount: 5, promoCost: "88.00" })
      .expect(200);
    expect(saved.body.report.reviewStatus).toBe("pending");
    expect(saved.body.report.reviewVersion).toBe(1);

    const cs = await login("cs_a1");
    await write(cs.agent, cs.csrf, "post", "/api/reviews")
      .send({
        entityType: "ops_report",
        entityId: saved.body.report.id,
        action: "approve",
        version: 1
      })
      .expect(403);

    const asst = await login("assistant");
    await write(asst.agent, asst.csrf, "post", "/api/reviews")
      .send({
        entityType: "ops_report",
        entityId: saved.body.report.id,
        action: "reject",
        version: 1
      })
      .expect(400);
    const rejected = await write(asst.agent, asst.csrf, "post", "/api/reviews")
      .send({
        entityType: "ops_report",
        entityId: saved.body.report.id,
        action: "reject",
        version: 1,
        reason: "推广费需补充说明"
      })
      .expect(200);
    expect(rejected.body.item.reviewStatus).toBe("rejected");
    expect(rejected.body.item.reviewReason).toBe("推广费需补充说明");

    const history = await asst.agent
      .get(`/api/reviews/ops_report/${saved.body.report.id}/history`)
      .expect(200);
    expect(history.body.history.some((item: { action: string; reason: string }) => item.action === "rejected" && item.reason === "推广费需补充说明")).toBe(true);
  });

  it("修改已审数据会回到待审，旧版本审核会冲突", async () => {
    const edit = await login("edit1");
    const created = await write(edit.agent, edit.csrf, "put", "/api/editor-reports")
      .send({
        businessDate: today,
        shootCount: 3,
        finishedCount: 4,
        publishedCount: 1,
        inventorySnapshot: 13
      })
      .expect(200);
    const asst = await login("assistant");
    const approved = await write(asst.agent, asst.csrf, "post", "/api/reviews")
      .send({
        entityType: "editor_report",
        entityId: created.body.report.id,
        action: "approve",
        version: created.body.report.reviewVersion
      })
      .expect(200);
    expect(approved.body.item.reviewStatus).toBe("approved");

    const revised = await write(edit.agent, edit.csrf, "put", "/api/editor-reports")
      .send({
        businessDate: today,
        shootCount: 6,
        finishedCount: 4,
        publishedCount: 1,
        inventorySnapshot: 13
      })
      .expect(200);
    expect(revised.body.report.reviewStatus).toBe("pending");
    expect(revised.body.report.reviewVersion).toBeGreaterThan(created.body.report.reviewVersion);

    const stale = await write(asst.agent, asst.csrf, "post", "/api/reviews")
      .send({
        entityType: "editor_report",
        entityId: created.body.report.id,
        action: "approve",
        version: created.body.report.reviewVersion
      })
      .expect(409);
    expect(stale.body.code).toBe("review_version_conflict");

    const again = await write(asst.agent, asst.csrf, "post", "/api/reviews")
      .send({
        entityType: "editor_report",
        entityId: created.body.report.id,
        action: "approve",
        version: revised.body.report.reviewVersion
      })
      .expect(200);
    expect(again.body.item.reviewStatus).toBe("approved");
  });

  it("Boss 按待审/退回/通过分开展示日常指标，工资保持整体且不生成分状态净利润", async () => {
    const cs = await login("cs_a1");
    const fan = await write(cs.agent, cs.csrf, "put", "/api/fan-reports")
      .send({ addedCount: 9, businessDate: today })
      .expect(200);
    expect(fan.body.report.reviewStatus).toBe("pending");
    const order = await write(cs.agent, cs.csrf, "post", "/api/orders")
      .send({
        businessDate: today,
        orderRef: "REV-1",
        amount: "100.00",
        status: "placed",
        customProductCost: "10.00",
        laborCost: "5.00",
        shippingCost: "2.00"
      })
      .expect(201);
    expect(order.body.order.reviewStatus).toBe("pending");

    const boss = await login("boss");
    await write(boss.agent, boss.csrf, "post", "/api/salaries")
      .send({ userId: ids.cs_a1, monthlyAmount: daysInMonthSafe(today) + ".00", effectiveFrom: today })
      .expect(201);
    const summary = await boss.agent.get("/api/dashboard/summary?preset=day&reviewStatus=approved").expect(200);
    expect(summary.body.selectedReviewStatus).toBe("approved");
    expect(summary.body.dailyByReviewStatus.pending).toBeTruthy();
    expect(summary.body.dailyByReviewStatus.approved).toBeTruthy();
    expect(summary.body.dailyByReviewStatus.rejected).toBeTruthy();
    expect(summary.body.dailyByReviewStatus.pending.revenue).toBe("100.00");
    expect(summary.body.dailyByReviewStatus.approved.revenue).toBe("0.00");
    expect(summary.body.dailyByReviewStatus.rejected.revenue).toBe("0.00");
    expect(summary.body.dailyByReviewStatus.pending.fanAddedTotal).toBe(9);
    expect(summary.body.metrics.revenue).toBe("100.00");
    expect(summary.body.overallSalary.allocated).toBe(summary.body.metrics.salaryAllocated);
    expect(summary.body.dailyByReviewStatus.pending).not.toHaveProperty("estimate");
    expect(summary.body.dailyByReviewStatus.approved).not.toHaveProperty("salaryAllocated");
    expect(summary.body.estimateScope).toBe("all_daily_minus_overall_salary");

    const asst = await login("assistant");
    await write(asst.agent, asst.csrf, "post", "/api/reviews")
      .send({
        entityType: "order",
        entityId: order.body.order.id,
        action: "approve",
        version: order.body.order.reviewVersion
      })
      .expect(200);
    const after = await boss.agent.get("/api/dashboard/summary?preset=day").expect(200);
    expect(after.body.dailyByReviewStatus.approved.revenue).toBe("100.00");
    expect(after.body.dailyByReviewStatus.pending.revenue).toBe("0.00");
    expect(after.body.metrics.revenue).toBe("100.00");
  });

  it("不能审核自己名下的数据，审核记录写入审计", async () => {
    await db.query(
      `INSERT INTO ops_reports (user_id, business_date, platform, promo_video_count, promo_cost, last_submitted_by)
       VALUES ($1, $2, 'self', 1, 1, $1)`,
      [ids.assistant, today]
    );
    const own = await db.query("SELECT id, review_version FROM ops_reports WHERE platform = 'self'");
    const asst = await login("assistant");
    await write(asst.agent, asst.csrf, "post", "/api/reviews")
      .send({
        entityType: "ops_report",
        entityId: own.rows[0].id,
        action: "approve",
        version: own.rows[0].review_version
      })
      .expect(403);
    const other = await login("assistant2");
    await write(other.agent, other.csrf, "post", "/api/reviews")
      .send({
        entityType: "ops_report",
        entityId: own.rows[0].id,
        action: "approve",
        version: own.rows[0].review_version
      })
      .expect(200);
    const audits = await db.query(
      "SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'review_%'",
      [own.rows[0].id]
    );
    expect(audits.rows.some((row: { action: string }) => row.action === "review_approved")).toBe(true);
  });
});

function daysInMonthSafe(iso: string): number {
  const [year, month] = iso.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}
