import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { isDatabaseUnavailable, withTransaction } from "../src/db.js";

describe("database transactions", () => {
  it("returns the committed result and releases a working connection", async () => {
    const query = vi.fn();
    const release = vi.fn();
    const db = { connect: async () => ({ query, release }) } as unknown as Pool;
    const result = await withTransaction(db, async () => "snapshot", true);
    expect(result).toBe("snapshot");
    expect(query.mock.calls).toEqual([["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"], ["COMMIT"]]);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("discards a broken connection when rollback fails and preserves the original failure", async () => {
    const failure = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" });
    const query = vi.fn(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("Connection terminated");
    });
    const release = vi.fn();
    const db = { connect: async () => ({ query, release }) } as unknown as Pool;
    await expect(withTransaction(db, async () => { throw failure; })).rejects.toBe(failure);
    expect(query.mock.calls).toEqual([["BEGIN"], ["ROLLBACK"]]);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
    expect(isDatabaseUnavailable(failure)).toBe(true);
  });
});
