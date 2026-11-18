import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { guardModuleWrites, parseModuleConfig } from "../src/lib/modules.js";
import { createModulesRouter } from "../src/routes/modules.js";
import { HttpError } from "../src/types.js";

function fixture(role = "admin") {
  let value: string | undefined;
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith("SELECT value")) return { rows: value ? [{ value }] : [], rowCount: value ? 1 : 0 };
    if (sql.startsWith("INSERT INTO app_settings") && !value) value = String(args[1]);
    if (sql.startsWith("UPDATE app_settings")) value = String(args[1]);
    if (sql.includes("FROM audit_logs a")) return { rows: [{ created_at: "2026-11-18T10:00:00.000Z", display_name: "周文" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const db = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = { id: "boss-id", role } as Express.Request["actor"]; next(); });
  app.use("/modules", createModulesRouter(db));
  app.use("/ops", guardModuleWrites(db, "ops"));
  app.use("/warehouse", guardModuleWrites(db, "warehouse"));
  app.put("/warehouse", (_req, res) => res.json({ saved: true }));
  app.use("/orders", guardModuleWrites(db, "orders"));
  app.put("/orders", (_req, res) => res.json({ saved: true }));
  app.get("/ops", (_req, res) => res.json({ historical: true }));
  app.put("/ops", (_req, res) => res.json({ saved: true }));
  app.use((error: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
  return { app, query, db };
}
describe("module administration", () => {
  it("defaults existing installations to all modules enabled", async () => {
    const { app } = fixture();
    const result = await request(app).get("/modules").expect(200);
    expect(result.body).toMatchObject({ version: 0, modules: { fans: true, ops: true, editor: true, orders: true, warehouse: true } });
  });
  it.each(["boss", "cs", "cs_supervisor", "ops", "editor", "assistant"])("rejects configuration changes by %s before connecting", async (role) => {
    const { app, db } = fixture(role);
    await request(app).put("/modules").send({ version: 0, modules: { ops: false } }).expect(403);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it("disables writes while preserving reads, audits changes, and re-enables", async () => {
    const { app, query } = fixture();
    await request(app).put("/modules").send({ version: 0, modules: { ops: false } }).expect(200);
    const denied = await request(app).put("/ops").send({}).expect(403);
    expect(denied.body.code).toBe("MODULE_DISABLED");
    expect((await request(app).get("/ops").expect(200)).body.historical).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    await request(app).put("/modules").send({ version: 1, modules: { ops: true } }).expect(200);
    await request(app).put("/ops").send({}).expect(200);
    expect(query.mock.calls.some(([sql]) => /DELETE|TRUNCATE/.test(sql))).toBe(false);
  });
  it("rejects stale versions without overwriting current configuration", async () => {
    const { app } = fixture();
    await request(app).put("/modules").send({ version: 0, modules: { fans: false } }).expect(200);
    await request(app).put("/modules").send({ version: 0, modules: { ops: false } }).expect(409);
    expect((await request(app).get("/modules")).body.modules).toMatchObject({ fans: false, ops: true });
  });
  it.each([{ version: 0, modules: { auth: false } }, { version: 0, modules: { ops: "false" } }, { version: 0, modules: {} }, { modules: { ops: false } }])("validates configuration payload %j", async (payload) => {
    const { app, db } = fixture();
    await request(app).put("/modules").send(payload).expect(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it("fails closed for corrupt persisted configuration", () => {
    expect(() => parseModuleConfig('{"version":1,"modules":{"ops":"false"}}')).toThrow();
  });
  it("treats a configuration saved before the warehouse switch existed as enabled", () => {
    const legacy = JSON.stringify({ version: 3, modules: { fans: true, ops: false, editor: true, orders: true } });
    expect(parseModuleConfig(legacy)).toEqual({ version: 3, modules: { fans: true, ops: false, editor: true, orders: true, warehouse: true } });
    expect(() => parseModuleConfig(JSON.stringify({ version: 1, modules: { fans: true, ops: true, editor: true } }))).toThrow();
    expect(() => parseModuleConfig(JSON.stringify({ version: 1, modules: { fans: true, ops: true, editor: true, orders: true, warehouse: "no" } }))).toThrow();
  });
  it("switches warehouse and orders independently", async () => {
    const { app } = fixture();
    await request(app).put("/modules").send({ version: 0, modules: { orders: false } }).expect(200);
    await request(app).put("/orders").send({}).expect(403);
    await request(app).put("/warehouse").send({}).expect(200);
    await request(app).put("/modules").send({ version: 1, modules: { orders: true, warehouse: false } }).expect(200);
    await request(app).put("/orders").send({}).expect(200);
    expect((await request(app).put("/warehouse").send({}).expect(403)).body.code).toBe("MODULE_DISABLED");
  });
  it("explains every switch and shows the last change to administrators only", async () => {
    const admin = fixture("admin");
    const body = (await request(admin.app).get("/modules").expect(200)).body;
    expect(Object.keys(body.details).sort()).toEqual(Object.keys(body.labels).sort());
    expect(body.lastChange).toEqual({ at: "2026-11-18T10:00:00.000Z", by: "周文" });
    const finance = fixture("finance");
    expect((await request(finance.app).get("/modules").expect(200)).body.lastChange).toBeNull();
  });
});
