import type { Pool, PoolClient } from "pg";

export async function writeAudit(
  db: Pool | PoolClient,
  entry: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.ip ?? null
    ]
  );
}
