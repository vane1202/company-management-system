import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createAdminRouter } from "../src/routes/admin.js";

function fixture(role = "admin", duplicate = false) {
  const original = { id: "staff-id", username: "old-login", display_name: "秋菊", role: "cs_supervisor", is_active: true, account_kind: "employee" };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT id, username")) return { rows: [original], rowCount: 1 };
    if (sql.startsWith("SELECT id FROM users WHERE username")) return { rows: duplicate ? [{ id: "other" }] : [], rowCount: duplicate ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = { id: "admin-id", role } as typeof req.actor; next(); });
  app.use("/admin", createAdminRouter(pool as unknown as Pool));
  app.use((error: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message });
  });
  return { app, query };
}

describe("administrator account profile editing", () => {
  it("renames the same account and audits both login names", async () => {
    const { app, query } = fixture();
    await request(app).patch("/admin/users/staff-id").send({ username: "kefu001", displayName: "秋菊" }).expect(200);
    const update = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE users"));
    expect(update?.[1]).toEqual(["秋菊", "cs_supervisor", true, "staff-id", "kefu001"]);
    const audit = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO audit_logs"));
    expect(String(audit?.[1])).toContain("old-login");
    expect(String(audit?.[1])).toContain("kefu001");
  });
  it.each([{ username: "a" }, { displayName: "x".repeat(65) }])("rejects invalid profile %j", async payload => {
    const { app, query } = fixture();
    await request(app).patch("/admin/users/staff-id").send(payload).expect(400);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE users"))).toBe(false);
  });
  it("rejects a duplicate login without updating the account", async () => {
    const { app, query } = fixture("admin", true);
    await request(app).patch("/admin/users/staff-id").send({ username: "kefu001" }).expect(409);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE users"))).toBe(false);
  });
  it("does not grant supervisors employee administration", async () => {
    const { app, query } = fixture("cs_supervisor");
    await request(app).patch("/admin/users/staff-id").send({ username: "kefu001" }).expect(403);
    expect(query).not.toHaveBeenCalled();
  });
});
