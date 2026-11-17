import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Pool } from "pg";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/lib/password.js";
import { assertNotDemoDatabase } from "./safeDatabase.js";
import { businessToday } from "../src/lib/dates.js";

describe("production warehouse workflow in an isolated database", () => {
  let db: Pool, app: Express, today: string;
  const origin = "http://127.0.0.1:13080", password = "IsolatedWarehouse47!";
  const clients: Record<string, { agent: ReturnType<typeof request.agent>; token: string; id: string }> = {};
  async function post(role: string, body: object, path = "/api/warehouse") {
    const client = clients[role];
    return client.agent.post(path).set("Origin", origin).set("X-CSRF-Token", client.token).send(body);
  }
  async function order() {
    const response = await post("cs", { requestKey: randomUUID(), orderRef: "WH-" + randomUUID(), businessDate: today,
      personaName: "测试主页", personaCode: "WH-P", liveRoomCode: "WH-L", hostName: "测试主播", customerCode: "WH-C", operatorName: "测试客服", customerLabel: "测试客户", source: "测试", customerCurrency: "CNY", customerDue: "1100.00",
      items: [{ kind: "material", label: "测试原石", priceCny: "1000.00" }] }, "/api/order-records");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.id as string;
  }
  const billBody = (orderId: string, extra: object = {}) => ({ action: "create", orderId, requestKey: randomUUID(),
    category: "goods", label: "测试供货款", counterparty: "测试供货方", amount: "400.00", date: today, materialRef: "WH-001", proof: "凭证-001", note: "", ...extra });
  async function create(body: object, role = "warehouse") {
    const response = await post(role, body);
    expect(response.status).toBe(200);
    return response.body.state.bills.at(-1);
  }
  async function approve(bill: { id: string; version: number }, extra: object = {}) {
    return post("finance", { action: "review", id: bill.id, version: bill.version, decision: "approved", reason: "已核对供货单", requestKey: randomUUID(), ...extra }, "/api/finance/warehouse");
  }
  async function pay(bill: { id: string; version: number }, extra: object = {}) {
    return post("finance", { action: "pay", id: bill.id, version: bill.version, amount: "100.00", date: today,
      payee: "测试供货方", account: "测试公司账户", reference: randomUUID(), requestKey: randomUUID(), ...extra }, "/api/finance/warehouse");
  }

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL ?? "", target = assertNotDemoDatabase(url);
    if (target.host !== "127.0.0.1" || target.port !== "16542" || target.name !== "cms_warehouse_test") throw Error("仅允许本机16542端口的独立cms_warehouse_test测试库");
    process.env.DATABASE_URL = url; process.env.SESSION_SECRET = "isolated-warehouse-tests-only-47"; process.env.APP_ORIGIN = origin; process.env.LOGIN_MAX_ATTEMPTS = "200";
    const config = loadConfig(); today = businessToday(new Date(), config.businessTimezone); db = createPool(url);
    await migrate(db); await db.query("TRUNCATE users,teams,session CASCADE");
    app = createApp(db, config); const hash = await hashPassword(password);
    for (const role of ["warehouse", "finance", "cs", "admin", "boss", "ops", "editor", "cs_supervisor", "otherwarehouse"]) {
      const username = role + "_user";
      const id = (await db.query("INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES($1,$1,$2,$3,FALSE) RETURNING id", [username, hash, role === "otherwarehouse" ? "warehouse" : role])).rows[0].id;
      const agent = request.agent(app), csrf = (await agent.get("/api/auth/csrf")).body.csrfToken;
      const login = await agent.post("/api/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ username, password }).expect(200);
      clients[role] = { agent, id, token: login.body.csrfToken };
    }
  });
  afterAll(async () => { await db?.end(); });

  it("supports creating a real warehouse employee through administrator API", async () => {
    const response = await post("admin", { username: "warehouse_new", displayName: "测试库管", password, role: "warehouse" }, "/api/admin/users");
    expect(response.status).toBe(201); expect(response.body.user.role).toBe("warehouse");
  });
  it.each(["boss", "admin", "cs", "ops", "editor", "cs_supervisor"])("denies %s warehouse data", async role => {
    await clients[role].agent.get("/api/warehouse").expect(403);
    await clients[role].agent.get("/api/finance/warehouse").expect(403);
  });
  it.each(["/api/admin/users", "/api/finance", "/api/orders", "/api/salaries", "/api/ops-reports"])("does not expand warehouse access to %s", async path => {
    await clients.warehouse.agent.get(path).expect(403);
  });
  it("requires CSRF and disallows warehouse approval/payment or finance submission", async () => {
    const body = billBody(await order());
    await clients.warehouse.agent.post("/api/warehouse").set("Origin", origin).send(body).expect(403);
    expect((await post("warehouse", { ...body, action: "review" })).status).toBe(403);
    expect((await post("warehouse", { ...body, action: "pay" })).status).toBe(403);
    expect((await post("finance", body, "/api/finance/warehouse")).status).toBe(403);
  });
  it("persists, approves once, pays in parts and shares the existing supplier ledger without duplicate cost", async () => {
    const orderId = await order(), body = billBody(orderId), bill = await create(body);
    expect((await db.query("SELECT count(*) FROM order_expenses WHERE order_id=$1", [orderId])).rows[0].count).toBe("0");
    const repeated = await post("warehouse", body);
    expect(repeated.status).toBe(200); expect(repeated.body.state.bills.filter((row: { id: string }) => row.id === bill.id)).toHaveLength(1);
    expect((await post("warehouse", { ...body, amount: "401.00" })).status).toBe(409);
    const approvalKey = randomUUID(), approval = await approve(bill, { requestKey: approvalKey });
    expect(approval.status).toBe(200);
    expect((await approve(bill, { requestKey: approvalKey })).status).toBe(200);
    expect((await approve(bill)).status).toBe(409);
    const approved = approval.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    const paymentKey = randomUUID(), reference = randomUUID();
    const first = await pay(approved, { requestKey: paymentKey, reference }); expect(first.status).toBe(200);
    expect((await pay(approved, { requestKey: paymentKey, reference })).status).toBe(200);
    const latest = first.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    expect((await pay(latest, { amount: "301.00" })).status).toBe(409);
    const last = await pay(latest, { amount: "300.00" }); expect(last.status).toBe(200);
    const paid = last.body.state.payments.filter((row: { billId: string }) => row.billId === bill.id);
    expect(paid).toHaveLength(2);
    expect((await db.query("SELECT custom_product_cost::text FROM orders WHERE id=$1", [orderId])).rows[0].custom_product_cost).toBe("400.00");
    expect((await db.query("SELECT count(*) FROM order_expenses WHERE order_id=$1", [orderId])).rows[0].count).toBe("1");
    const visible = (await clients.warehouse.agent.get("/api/warehouse").expect(200)).body;
    expect(visible.state.payments.every((row: { account: string; reference: string }) => row.account === "" && row.reference === "")).toBe(true);
    expect(visible.orders.find((row: { id: string }) => row.id === orderId)).not.toHaveProperty("amount");
    const ledger = (await clients.finance.agent.get("/api/finance/payables").expect(200)).body;
    expect(ledger.expenses.find((row: { id: string }) => row.id === approved.expenseId).pending_cny).toBe("0.00");
  });
  it("links a previous cost with prior payments without adding it twice and rejects duplicate bills", async () => {
    const orderId = await order();
    const expense = await post("cs", { businessDate: today, category: "goods", label: "已有成本", amountCny: "500.00", requestKey: randomUUID() }, `/api/order-records/${orderId}/expenses`);
    expect(expense.status).toBe(200);
    const paid = await post("finance", { expenseId: expense.body.id, paidOn: today, payee: "测试供货方", account: "测试公司", reference: randomUUID(), amountCny: "100.00", requestKey: randomUUID() }, "/api/finance/payables/payments");
    expect(paid.status).toBe(200);
    const body = billBody(orderId, { expenseId: expense.body.id }), bill = await create(body);
    expect((await post("warehouse", { ...body, requestKey: randomUUID() })).status).toBe(409);
    const approval = await approve(bill); expect(approval.status).toBe(200);
    expect((await db.query("SELECT count(*) FROM order_expenses WHERE order_id=$1", [orderId])).rows[0].count).toBe("1");
    expect((await post("finance", { expenseId: expense.body.id, paidOn: today, payee: "测试供货方", account: "测试公司", reference: randomUUID(), amountCny: "1.00", requestKey: randomUUID() }, "/api/finance/payables/payments")).status).toBe(409);
    expect((await post("cs", { reason: "测试作废", requestKey: randomUUID() }, `/api/order-records/${orderId}/expenses/${expense.body.id}/void`)).status).toBe(409);
  });
  it("returns a bill for correction only by its original warehouse operator", async () => {
    const body = billBody(await order()), bill = await create(body);
    const rejected = await approve(bill, { decision: "rejected", reason: "凭证不完整" }); expect(rejected.status).toBe(200);
    const current = rejected.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    const revision = { ...body, action: "resubmit", id: bill.id, version: current.version, requestKey: randomUUID(), proof: "补齐凭证" };
    expect((await post("otherwarehouse", revision)).status).toBe(403);
    const response = await post("warehouse", revision); expect(response.status).toBe(200);
    const updated = response.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    expect(updated.status).toBe("submitted"); expect(updated.proof).toBe("补齐凭证");
    expect((await approve(updated)).status).toBe(200);
  });
  it("rejects invalid money, missing proof, future dates and mismatched order links", async () => {
    const body = billBody(await order());
    for (const extra of [{ amount: "0" }, { amount: "-1" }, { proof: "" }, { date: "2999-01-01" }, { category: "unknown" }]) expect((await post("warehouse", { ...body, ...extra, requestKey: randomUUID() })).status).toBe(400);
    expect((await post("warehouse", { ...body, expenseId: randomUUID() })).status).toBe(409);
  });
  it("serializes simultaneous payments and rejects stale versions", async () => {
    const bill = await create(billBody(await order())), approval = await approve(bill);
    const current = approval.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    const responses = await Promise.all([pay(current, { amount: "300.00" }), pay(current, { amount: "300.00" })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const paid = (await db.query("SELECT sum(amount_cny)::text AS total FROM supplier_payments WHERE warehouse_bill_id=$1", [bill.id])).rows[0].total;
    expect(paid).toBe("300.00");
  });
  it("reverses an unpaid approved new cost before allowing correction", async () => {
    const orderId = await order(), body = billBody(orderId), bill = await create(body), approval = await approve(bill);
    const current = approval.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    const withdrawal = await post("finance", { action: "withdraw", id: bill.id, version: current.version, reason: "成本金额需更正", requestKey: randomUUID() }, "/api/finance/warehouse");
    expect(withdrawal.status).toBe(200);
    const rejected = withdrawal.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    expect(rejected.status).toBe("rejected"); expect(rejected.expenseId).toBeNull();
    expect((await db.query("SELECT custom_product_cost::text FROM orders WHERE id=$1", [orderId])).rows[0].custom_product_cost).toBe("0.00");
    const revised = await post("warehouse", { ...body, action: "resubmit", id: bill.id, version: rejected.version, amount: "410.00", requestKey: randomUUID() });
    expect(revised.status).toBe(200);
    const resubmitted = revised.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    expect((await approve(resubmitted)).status).toBe(200);
    expect((await db.query("SELECT custom_product_cost::text FROM orders WHERE id=$1", [orderId])).rows[0].custom_product_cost).toBe("410.00");
  });
  it("requires payment correction before withdrawing approval and reopens the payable after voiding", async () => {
    const bill = await create(billBody(await order())), approved = await approve(bill);
    const current = approved.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    const payment = await pay(current); expect(payment.status).toBe(200);
    const latest = payment.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    expect((await post("finance", { action: "withdraw", id: bill.id, version: latest.version, reason: "先纠错", requestKey: randomUUID() }, "/api/finance/warehouse")).status).toBe(409);
    const paid = payment.body.state.payments.find((row: { billId: string }) => row.billId === bill.id);
    expect((await post("finance", { reason: "付款登记错误" }, `/api/finance/payables/payments/${paid.id}/void`)).status).toBe(200);
    const data = (await clients.finance.agent.get("/api/finance/warehouse").expect(200)).body;
    expect(data.state.payments.some((row: { id: string }) => row.id === paid.id)).toBe(false);
    expect((await pay(latest, { amount: "400.00" })).status).toBe(200);
  });
  it("associates after-sales cost with its charge and never changes customer revenue", async () => {
    const orderId = await order();
    const charge = await post("cs", { businessDate: today, label: "售后关公", amountCny: "600.00", requestKey: randomUUID() }, `/api/order-records/${orderId}/charges`);
    expect(charge.status).toBe(200);
    const revenue = (await db.query("SELECT amount::text FROM orders WHERE id=$1", [orderId])).rows[0].amount;
    const bill = await create(billBody(orderId, { category: "sourcing", afterSaleChargeId: charge.body.id, amount: "445.00" }));
    const approval = await approve(bill); expect(approval.status).toBe(200);
    const cost = (await db.query("SELECT amount_cny::text,after_sale_charge_id FROM order_expenses WHERE order_id=$1", [orderId])).rows[0];
    expect(cost).toMatchObject({ amount_cny: "445.00", after_sale_charge_id: charge.body.id });
    expect((await db.query("SELECT amount::text FROM orders WHERE id=$1", [orderId])).rows[0].amount).toBe(revenue);
  });
  it("does not allow resubmission to bypass cancelled-order checks", async () => {
    const orderId = await order(), body = billBody(orderId), bill = await create(body);
    const rejected = await approve(bill, { decision: "rejected", reason: "订单取消" });
    expect(rejected.status).toBe(200);
    await db.query("UPDATE orders SET status='refunded' WHERE id=$1", [orderId]);
    const current = rejected.body.state.bills.find((row: { id: string }) => row.id === bill.id);
    expect((await post("warehouse", { ...body, id: bill.id, version: current.version, action: "resubmit", decision: "rejected", requestKey: randomUUID() })).status).toBe(409);
    expect((await post("warehouse", billBody(orderId))).status).toBe(409);
  });
  it("serializes competing migration runners", async () => {
    const results = await Promise.all([migrate(db), migrate(db)]);
    expect(results).toEqual([[], []]);
  });
});
