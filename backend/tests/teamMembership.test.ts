import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { setUserTeamMembership } from "../src/users.js";

type MembershipRow = { id: string; user_id: string; team_id: string; start_date: string; end_date: string | null };

function createMockClient(initial: MembershipRow[]) {
  let rows = initial.map((row) => ({ ...row }));
  let seq = 1;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.trimStart().startsWith("SELECT")) {
        const userId = params[0] as string;
        const open = rows
          .filter((r) => r.user_id === userId && r.end_date === null)
          .sort((a, b) => b.start_date.localeCompare(a.start_date));
        return { rows: open.slice(0, 1), rowCount: open.length ? 1 : 0 };
      }
      if (sql.startsWith("DELETE FROM team_memberships")) {
        const id = params[0] as string;
        rows = rows.filter((r) => r.id !== id);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE team_memberships SET end_date")) {
        const [endDate, id] = params as [string, string];
        const target = rows.find((r) => r.id === id);
        if (target) target.end_date = endDate;
        return { rows: [], rowCount: target ? 1 : 0 };
      }
      if (sql.startsWith("INSERT INTO team_memberships")) {
        const [userId, teamId, startDate] = params as [string, string, string];
        rows.push({ id: `m-${seq++}`, user_id: userId, team_id: teamId, start_date: startDate, end_date: null });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  } as unknown as PoolClient;
  return { client, getRows: () => rows };
}

describe("setUserTeamMembership", () => {
  it("assigns a team when the user has no active membership", async () => {
    const { client, getRows } = createMockClient([]);
    const result = await setUserTeamMembership(client, {
      userId: "u1",
      teamId: "t1",
      effectiveDate: "2026-11-18"
    });
    expect(result).toEqual({ changed: true, previousTeamId: null });
    expect(getRows()).toEqual([
      { id: "m-1", user_id: "u1", team_id: "t1", start_date: "2026-11-18", end_date: null }
    ]);
  });

  it("closes prior membership the day before effectiveDate when transferring later", async () => {
    const { client, getRows } = createMockClient([
      { id: "m-old", user_id: "u1", team_id: "t1", start_date: "2026-11-10", end_date: null }
    ]);
    const result = await setUserTeamMembership(client, {
      userId: "u1",
      teamId: "t2",
      effectiveDate: "2026-11-18"
    });
    expect(result).toEqual({ changed: true, previousTeamId: "t1" });
    expect(getRows()).toEqual([
      { id: "m-old", user_id: "u1", team_id: "t1", start_date: "2026-11-10", end_date: "2026-11-17" },
      { id: "m-1", user_id: "u1", team_id: "t2", start_date: "2026-11-18", end_date: null }
    ]);
  });

  it("replaces same-day membership without leaving overlapping active rows", async () => {
    const { client, getRows } = createMockClient([
      { id: "m-today", user_id: "u1", team_id: "t1", start_date: "2026-11-18", end_date: null }
    ]);
    const result = await setUserTeamMembership(client, {
      userId: "u1",
      teamId: "t2",
      effectiveDate: "2026-11-18"
    });
    expect(result).toEqual({ changed: true, previousTeamId: "t1" });
    expect(getRows()).toEqual([
      { id: "m-1", user_id: "u1", team_id: "t2", start_date: "2026-11-18", end_date: null }
    ]);
  });

  it("supports unassigning a user from their current team", async () => {
    const { client, getRows } = createMockClient([
      { id: "m-old", user_id: "u1", team_id: "t1", start_date: "2026-11-10", end_date: null }
    ]);
    const result = await setUserTeamMembership(client, {
      userId: "u1",
      teamId: null,
      effectiveDate: "2026-11-18"
    });
    expect(result).toEqual({ changed: true, previousTeamId: "t1" });
    expect(getRows()).toEqual([
      { id: "m-old", user_id: "u1", team_id: "t1", start_date: "2026-11-10", end_date: "2026-11-17" }
    ]);
  });

  it("rejects effectiveDate earlier than current membership start_date", async () => {
    const { client } = createMockClient([
      { id: "m-old", user_id: "u1", team_id: "t1", start_date: "2026-11-15", end_date: null }
    ]);
    await expect(
      setUserTeamMembership(client, {
        userId: "u1",
        teamId: "t2",
        effectiveDate: "2026-11-14"
      })
    ).rejects.toThrow("调组日期不能早于当前归属起始日");
  });
});
