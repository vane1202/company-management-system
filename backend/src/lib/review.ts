import type { Pool, PoolClient } from "pg";
import { queryOne } from "../db.js";

export type ReviewEntityType = "ops_report" | "editor_report" | "fan_report" | "order";

export function reviewPublicFields(row: Record<string, unknown> | undefined) {
  return row ? { recordVersion: Number(row.review_version ?? 1), lastSubmittedBy: row.last_submitted_by ?? null } : {};
}

export async function recordSubmission(db: Pool | PoolClient, options: { table: string; entityType: ReviewEntityType; id: string; actorId: string; changed: boolean; isNew: boolean; ip?: string | null }): Promise<void> {
  if (!options.changed && !options.isNew) return;
  const tables = ["fan_reports", "ops_reports", "editor_reports", "orders"];
  if (!tables.includes(options.table)) throw new Error("Invalid business record table");
  const existing = await queryOne<Record<string, unknown>>(db, `SELECT id, review_version FROM ${options.table} WHERE id=$1`, [options.id]);
  if (!existing) return;
  const version = Number(existing.review_version ?? 1) + (options.isNew ? 0 : 1);
  await db.query(`UPDATE ${options.table} SET review_version=$2, last_submitted_by=$3, updated_at=now() WHERE id=$1`, [options.id, version, options.actorId]);
}
