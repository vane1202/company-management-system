import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { Pool } from "pg";
import type { Express } from "express";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { assertNotDemoDatabase } from "./safeDatabase.js";
import { randomUUID } from "node:crypto";

const ORIGIN = "http://127.0.0.1:13080", PASSWORD = "PayrollFixtureOnly1234", M = "2026-03";
describe("月度工资单：财务手工提成/奖金/扣款、锁定、BOSS只读（隔离数据库）", () => {
  let db: Pool, app: Express; const ids: Record<string, string> = {};
  const clients: Record<string, { agent: ReturnType<typeof request.agent>; token: string }> = {};
  const get = (who: string, url: string) => clients[who].agent.get(url);
  const post = (who: string, url: string, body: object) => clients[who].agent.post(url).set("Origin", ORIGIN).set("X-CSRF-Token", clients[who].token).send(body);
  const item = (who: string, body: object) => post(who, "/api/salaries/payroll/items", { month: M, requestKey: randomUUID(), ...body });
  const slip = async (who: string, userId = "", month = M) => (await get(who, `/api/salaries/payroll?month=${month}${userId ? `&userId=${userId}` : ""}`).expect(200)).body;
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL ?? "", target = assertNotDemoDatabase(url);
    if (target.name !== "cms_payroll_test" || target.port !== "16542" || target.host !== "127.0.0.1") throw Error("仅允许16542独立cms_payroll_test");
    process.env.DATABASE_URL = url; process.env.SESSION_SECRET = "isolated-payroll-items-fixture-secret"; process.env.APP_ORIGIN = ORIGIN; process.env.LOGIN_MAX_ATTEMPTS = "200";
    db = createPool(url); await migrate(db);
    expect((await db.query("SELECT current_database() AS n")).rows[0].n).toBe("cms_payroll_test");
    await db.query("TRUNCATE users,teams,session CASCADE");
    const hash = await hashPassword(PASSWORD);
    for (const [name, role] of [["finance", "finance"], ["boss", "boss"], ["admin", "admin"], ["supervisor", "cs_supervisor"], ["assistant", "assistant"], ["cashier", "cs"], ["opsone", "ops"], ["opstwo", "ops"], ["editor", "editor"]])
      ids[name] = (await db.query("INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES($1,$1,$2,$3,FALSE) RETURNING id", [name, hash, role])).rows[0].id;
    ids.wechat = (await db.query("INSERT INTO users(username,display_name,password_hash,role,must_change_password,account_kind,wechat_id) VALUES('payroll_wx','测试微信',$1,'cs',FALSE,'cs_wechat','Fixture_Payroll_Wechat') RETURNING id", [hash])).rows[0].id;
    app = createApp(db, loadConfig());
    for (const name of ["finance", "boss", "admin", "supervisor", "assistant", "cashier"]) {
      const agent = request.agent(app), csrf = (await agent.get("/api/auth/csrf")).body.csrfToken;
      const login = await agent.post("/api/auth/login").set("Origin", ORIGIN).set("X-CSRF-Token", csrf).send({ username: name, password: PASSWORD }).expect(200);
      clients[name] = { agent, token: login.body.csrfToken };
    }
    await post("finance", "/api/salaries", { userId: ids.opsone, monthlyAmount: "3100.00", effectiveFrom: "2026-01-01" }).expect(201);
    await post("finance", "/api/salaries", { userId: ids.opstwo, monthlyAmount: "3100.00", effectiveFrom: "2026-03-16", effectiveTo: "2026-03-31" }).expect(201);
  });
  afterAll(async () => { await db?.end(); });

  it("仅财务可写；BOSS只读；管理员/主管/客服/助理看不到工资单", async () => {
    for (const who of ["finance", "boss"]) expect((await get(who, `/api/salaries/payroll?month=${M}`).expect(200)).headers["cache-control"]).toBe("private, no-store");
    for (const who of ["admin", "supervisor", "cashier", "assistant"]) {
      await get(who, `/api/salaries/payroll?month=${M}`).expect(403);
      await get(who, `/api/salaries/payroll/items?month=${M}`).expect(403);
      await item(who, { userId: ids.opsone, kind: "bonus", amount: "1.00", note: "x" }).expect(403);
    }
    await item("boss", { userId: ids.opsone, kind: "bonus", amount: "1.00", note: "x" }).expect(403);
    await post("boss", "/api/salaries/payroll/months/lock", { userId: ids.opsone, month: M, version: 0 }).expect(403);
    expect((await db.query("SELECT count(*)::int n FROM payroll_items")).rows[0].n).toBe(0);
  });

  it("输入校验：正数、两位小数、必填备注、月份格式、只能关联员工", async () => {
    const base = { userId: ids.opsone, kind: "commission", amount: "10.00", note: "三月成交提成（财务手填）" };
    await item("finance", { ...base, amount: "0" }).expect(400);
    await item("finance", { ...base, amount: "0.00" }).expect(400);
    await item("finance", { ...base, amount: "-5.00" }).expect(400);
    await item("finance", { ...base, amount: "1.005" }).expect(400);
    await item("finance", { ...base, amount: 10 }).expect(400);
    await item("finance", { ...base, note: "   " }).expect(400);
    await item("finance", { ...base, kind: "tax" }).expect(400);
    await item("finance", { ...base, month: "2026-13" }).expect(400);
    await item("finance", { ...base, requestKey: "not-a-uuid" }).expect(400);
    await item("finance", { ...base, userId: ids.wechat }).expect(400);
    await get("finance", "/api/salaries/payroll?month=2026-3").expect(400);
  });

  it("多条项目汇总到员工、岗位与全体；实发精确到分；底薪沿用自然日分摊", async () => {
    await item("finance", { userId: ids.opsone, kind: "commission", amount: "1200.33", note: "提成A" }).expect(201);
    await item("finance", { userId: ids.opsone, kind: "commission", amount: "0.01", note: "提成B" }).expect(201);
    await item("finance", { userId: ids.opsone, kind: "bonus", amount: "300.00", note: "全勤奖" }).expect(201);
    await item("finance", { userId: ids.opsone, kind: "deduction", amount: "50.55", note: "借支" }).expect(201);
    await item("finance", { userId: ids.editor, kind: "bonus", amount: "88.88", note: "仅奖金无底薪" }).expect(201);
    const body = await slip("boss");
    const one = body.employees.find((e: any) => e.userId === ids.opsone), two = body.employees.find((e: any) => e.userId === ids.opstwo), ed = body.employees.find((e: any) => e.userId === ids.editor);
    expect(one).toMatchObject({ base: "3100.00", commission: "1200.34", bonus: "300.00", deduction: "50.55", net: "4549.79", netNegative: false, status: "draft", statusVersion: 0 });
    expect(one.items).toHaveLength(4);
    expect(two).toMatchObject({ base: "1600.00", net: "1600.00" }); // 3100 × 16/31
    expect(ed).toMatchObject({ base: "0.00", bonus: "88.88", net: "88.88" });
    expect(body.roles.find((r: any) => r.role === "ops")).toMatchObject({ employeeCount: 2, base: "4700.00", net: "6149.79" });
    expect(body.totals).toMatchObject({ employeeCount: 3, base: "4700.00", commission: "1200.34", bonus: "388.88", deduction: "50.55", net: "6238.67", negativeCount: 0 });
    expect(await slip("finance")).toEqual(body);
    expect(body.employees.some((e: any) => e.userId === ids.wechat || e.userId === ids.cashier)).toBe(false);
    const other = await slip("finance", "", "2026-04");
    expect(other.employees.map((e: any) => e.userId)).toEqual([ids.opsone]);
    expect(other.employees[0]).toMatchObject({ base: "3100.00", commission: "0.00", net: "3100.00" });
  });

  it("网络重试同一提交标识只记一次；标识复用于不同内容被拒绝；每次新增都有审计", async () => {
    const key = randomUUID(), payload = { userId: ids.opstwo, kind: "bonus", amount: "20.00", note: "重试测试", requestKey: key };
    const [a, b] = await Promise.all([item("finance", payload), item("finance", payload)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.item.id).toBe(b.body.item.id);
    await item("finance", { ...payload, amount: "21.00" }).expect(409);
    expect((await db.query("SELECT count(*)::int n FROM payroll_items WHERE request_key=$1", [key])).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int n FROM audit_logs WHERE entity_type='payroll_item' AND entity_id=$1", [a.body.item.id])).rows[0].n).toBe(1);
  });

  it("作废需原因与版本；作废项目保留但不计入；更正=作废原项+新增更正项并留痕；BOSS可看轨迹", async () => {
    const created = (await item("finance", { userId: ids.opstwo, kind: "commission", amount: "500.00", note: "待更正" }).expect(201)).body.item;
    await post("boss", `/api/salaries/payroll/items/${created.id}/void`, { version: created.version, reason: "x" }).expect(403);
    await post("finance", `/api/salaries/payroll/items/${created.id}/correct`, { version: created.version, reason: "", kind: "commission", amount: "450.00", note: "更正后", requestKey: randomUUID() }).expect(400);
    await post("finance", `/api/salaries/payroll/items/${created.id}/correct`, { version: 99, reason: "金额填错", kind: "commission", amount: "450.00", note: "更正后", requestKey: randomUUID() }).expect(409);
    const corrected = (await post("finance", `/api/salaries/payroll/items/${created.id}/correct`, { version: created.version, reason: "金额填错", kind: "commission", amount: "450.00", note: "更正后", requestKey: randomUUID() }).expect(201)).body;
    expect(corrected.voided).toMatchObject({ id: created.id, voided: true, voidReason: "金额填错", correctedById: corrected.item.id });
    expect(corrected.item).toMatchObject({ correctsId: created.id, amount: "450.00", month: M, userId: ids.opstwo });
    await post("finance", `/api/salaries/payroll/items/${created.id}/void`, { version: corrected.voided.version, reason: "再作废" }).expect(409);
    const toVoid = (await item("finance", { userId: ids.opstwo, kind: "deduction", amount: "10.00", note: "误录" }).expect(201)).body.item;
    await post("finance", `/api/salaries/payroll/items/${toVoid.id}/void`, { version: toVoid.version, reason: "" }).expect(400);
    await post("finance", `/api/salaries/payroll/items/${toVoid.id}/void`, { version: toVoid.version, reason: "误录作废" }).expect(200);
    const two = (await slip("boss", ids.opstwo)).employees[0];
    expect(two).toMatchObject({ base: "1600.00", commission: "450.00", bonus: "20.00", deduction: "0.00", net: "2070.00" });
    expect(two.items.filter((i: any) => i.voided)).toHaveLength(2);
    const history = (await get("boss", `/api/salaries/payroll/items/${created.id}/history`).expect(200)).body.history;
    expect(history.map((h: any) => h.action)).toEqual(["payroll_item_void", "payroll_item_create"]);
    expect(history[0].after).toMatchObject({ reason: "金额填错", correctedBy: corrected.item.id });
    await get("admin", `/api/salaries/payroll/items/${created.id}/history`).expect(403);
  });

  it("并发作废/更正同一项目只有一个成功", async () => {
    const created = (await item("finance", { userId: ids.opsone, kind: "bonus", amount: "5.00", note: "并发" }).expect(201)).body.item;
    const results = await Promise.all([
      post("finance", `/api/salaries/payroll/items/${created.id}/void`, { version: created.version, reason: "并发A" }),
      post("finance", `/api/salaries/payroll/items/${created.id}/correct`, { version: created.version, reason: "并发B", kind: "bonus", amount: "6.00", note: "并发B", requestKey: randomUUID() })
    ]);
    const [voidRes, correctRes] = results;
    expect([voidRes.status, correctRes.status].filter(s => s === 409)).toHaveLength(1);
    expect(voidRes.status === 200 || correctRes.status === 201).toBe(true);
    expect((await db.query("SELECT count(*)::int n FROM payroll_items WHERE corrects_id=$1", [created.id])).rows[0].n).toBe(correctRes.status === 201 ? 1 : 0);
  });

  it("扣款大于应发时实发为负数并标记，不截断", async () => {
    await item("finance", { userId: ids.editor, kind: "deduction", amount: "100.00", note: "扣回多发" }).expect(201);
    const body = await slip("boss");
    expect(body.employees.find((e: any) => e.userId === ids.editor)).toMatchObject({ net: "-11.12", netNegative: true });
    expect(body.totals.negativeCount).toBe(1);
  });

  it("锁定后不能新增/作废/更正；锁定保存快照；底薪事后变动会被标记；解锁需原因；状态有版本保护", async () => {
    const before = (await slip("finance", ids.opsone)).employees[0];
    await post("finance", "/api/salaries/payroll/months/lock", { userId: ids.opsone, month: M, version: 5 }).expect(409);
    const locked = (await post("finance", "/api/salaries/payroll/months/lock", { userId: ids.opsone, month: M, version: 0 }).expect(200)).body.month;
    expect(locked).toMatchObject({ status: "locked", version: 1, lockedSnapshot: { base: "3100.00", net: before.net } });
    await post("finance", "/api/salaries/payroll/months/lock", { userId: ids.opsone, month: M, version: 1 }).expect(409);
    await item("finance", { userId: ids.opsone, kind: "bonus", amount: "1.00", note: "锁定后" }).expect(409);
    const target = before.items.find((i: any) => !i.voided);
    await post("finance", `/api/salaries/payroll/items/${target.id}/void`, { version: target.version, reason: "锁定后" }).expect(409);
    await post("finance", `/api/salaries/payroll/items/${target.id}/correct`, { version: target.version, reason: "锁定后", kind: "bonus", amount: "1.00", note: "x", requestKey: randomUUID() }).expect(409);
    await item("finance", { userId: ids.opsone, month: "2026-04", kind: "bonus", amount: "1.00", note: "其他月份不受影响" }).expect(201);
    // 锁定后财务调整工资标准：工资单仍显示锁定快照，并提示与实时计算不一致。
    const std = (await get("finance", `/api/salaries?userId=${ids.opsone}`)).body.salaries[0];
    await clients.finance.agent.patch(`/api/salaries/${std.id}`).set("Origin", ORIGIN).set("X-CSRF-Token", clients.finance.token).send({ monthlyAmount: "3200.00", effectiveFrom: "2026-01-01", effectiveTo: null, recordVersion: std.recordVersion, reason: "调薪测试" }).expect(200);
    const after = (await slip("boss", ids.opsone)).employees[0];
    expect(after).toMatchObject({ status: "locked", base: "3100.00", net: before.net, liveBase: "3200.00", changedAfterLock: true });
    await post("finance", "/api/salaries/payroll/months/unlock", { userId: ids.opsone, month: M, version: 1, reason: "" }).expect(400);
    await post("boss", "/api/salaries/payroll/months/unlock", { userId: ids.opsone, month: M, version: 1, reason: "x" }).expect(403);
    await post("finance", "/api/salaries/payroll/months/unlock", { userId: ids.opsone, month: M, version: 1, reason: "补录奖金" }).expect(200);
    const draft = (await slip("finance", ids.opsone)).employees[0];
    expect(draft).toMatchObject({ status: "draft", statusVersion: 2, base: "3200.00", changedAfterLock: false });
    const history = (await get("boss", `/api/salaries/payroll/months/history?userId=${ids.opsone}&month=${M}`).expect(200)).body.history;
    expect(history.map((h: any) => h.action)).toEqual(["payroll_month_unlock", "payroll_month_lock"]);
    expect(history[0].after.reason).toBe("补录奖金");
  });

  it("并发锁定与新增项目串行化：不会出现锁定快照漏掉已提交项目", async () => {
    const st = (await slip("finance", ids.opstwo)).employees[0];
    const [lock, add] = await Promise.all([
      post("finance", "/api/salaries/payroll/months/lock", { userId: ids.opstwo, month: M, version: st.statusVersion }),
      item("finance", { userId: ids.opstwo, kind: "bonus", amount: "7.77", note: "并发新增" })
    ]);
    expect(lock.status).toBe(200);
    const after = (await slip("finance", ids.opstwo)).employees[0];
    expect(after.changedAfterLock).toBe(false);
    if (add.status === 201) expect(after.bonus).toBe("27.77"); else { expect(add.status).toBe(409); expect(after.bonus).toBe("20.00"); }
  });

  it("经营估算仍只扣底薪分摊，不重复扣提成/奖金/扣款", async () => {
    const dash = (await get("boss", "/api/dashboard/summary?from=2026-03-01&to=2026-03-31").expect(200)).body;
    expect(dash.metrics.salaryAllocated).toBe("4800.00"); // opsone 3200（已调薪）+ opstwo 1600
    expect(dash.overallSalary.payrollItemsIncluded).toBe(false);
    await get("finance", "/api/dashboard/summary").expect(403);
  });
});
