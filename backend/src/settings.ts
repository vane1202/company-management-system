import type { Pool, PoolClient } from "pg";
import { queryOne } from "./db.js";

export async function getBackfillDays(db: Pool | PoolClient, fallback: number): Promise<number> {
  const row = await queryOne<{ value: string }>(
    db,
    "SELECT value FROM app_settings WHERE key = 'fan_report_backfill_days'"
  );
  const parsed = Number(row?.value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) return fallback;
  return parsed;
}
