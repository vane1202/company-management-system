import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { enforceRoleBoundary } from "../src/lib/access.js";

describe("administrator and supervisor service-account boundaries", () => {
  it.each(["GET", "HEAD", "POST", "PUT", "PATCH"])("rejects administrator %s service-account access before routing", method => {
    for (const path of ["/api/cs-accounts", "/api/cs-accounts/teams", "/api/cs-accounts/registration-codes", "/api/cs-accounts/account/status"]) {
      const next = vi.fn();
      enforceRoleBoundary({ path, method, actor: { role: "admin" } } as Request, {} as Response, next);
      expect(next.mock.calls[0][0]).toMatchObject({ status: 403 });
    }
  });
  it("preserves administrator settings and supervisor scoped routing", () => {
    for (const [role, path, method] of [["admin", "/api/admin/users", "POST"], ["admin", "/api/admin/teams", "GET"], ["admin", "/api/modules", "PUT"], ["cs_supervisor", "/api/cs-accounts", "GET"], ["cs_supervisor", "/api/cs-accounts/registration-codes", "POST"], ["cs_supervisor", "/api/cs-logins", "GET"], ["cs_supervisor", "/api/cs-logins", "POST"]]) {
      const next = vi.fn();
      enforceRoleBoundary({ path, method, actor: { role } } as Request, {} as Response, next);
      expect(next).toHaveBeenCalledWith();
    }
  });
});
