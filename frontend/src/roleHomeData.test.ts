import { afterEach, describe, expect, it, vi } from "vitest";
import { loaded, loadAdminHome, loadSupervisorHome } from "./roleHomeData";
import { navItems } from "./access";

afterEach(() => { vi.unstubAllGlobals(); });

describe("Role home request boundaries", () => {
  it("reserves service account navigation for supervisors", () => {
    expect(navItems("admin").map(item => item.id)).toEqual(["home", "people", "modules"]);
    expect(navItems("cs_supervisor").some(item => item.id === "csAccounts")).toBe(true);
  });
  it("admin overview requests configuration only, never business summaries", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (input: string, options: RequestInit) => {
      paths.push(input);
      expect(options.method ?? "GET").toBe("GET");
      const payload = input === "/api/admin/users" ? { users: [] } : input === "/api/admin/teams" ? { teams: [] } : input === "/api/cs-accounts" ? { accounts: [] } : { modules: { fans: true }, labels: {}, version: 1 };
      return new Response(JSON.stringify(payload));
    });
    const result = await loadAdminHome();
    expect(paths.sort()).toEqual(["/api/admin/teams", "/api/admin/users", "/api/modules"]);
    expect(Object.values(result).every(item => item.status === "fulfilled")).toBe(true);
  });

  it("supervisor loads the supplied business day using existing scoped APIs", async () => {
    const paths: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input, "http://localhost"); paths.push(url);
      const payload = url.pathname === "/api/orders" ? { orders: [], totals: { amount: "90071992547409.93", refunds: "0.00" } } : url.pathname === "/api/cs-accounts" ? { accounts: [] } : { teams: [] };
      return new Response(JSON.stringify(payload));
    });
    const result = await loadSupervisorHome("2026-11-09");
    expect(paths.map(url => url.pathname).sort()).toEqual(["/api/cs-accounts", "/api/fan-reports/summary", "/api/orders"]);
    const orders = paths.find(url => url.pathname === "/api/orders")!;
    expect([...orders.searchParams.entries()]).toEqual([["from", "2026-11-09"], ["to", "2026-11-09"]]);
    expect(paths.filter(url => url.pathname !== "/api/orders").every(url => url.searchParams.get("date") === "2026-11-09")).toBe(true);
    expect(loaded(result.orders)?.totals.amount).toBe("90071992547409.93");
  });

  it("a rejected source stays unavailable while independent sources remain usable", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      if (input.startsWith("/api/orders")) return new Response(JSON.stringify({ error: "权限已变更" }), { status: 403 });
      return new Response(JSON.stringify(input.startsWith("/api/fan") ? { teams: [] } : { accounts: [] }));
    });
    const result = await loadSupervisorHome("2026-11-09");
    expect(result.orders.status).toBe("rejected");
    expect(loaded(result.orders)).toBeNull();
    expect(loaded(result.fans)).toEqual({ teams: [] });
    expect(loaded(result.accounts)).toEqual({ accounts: [] });
  });
});
