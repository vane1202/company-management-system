import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { HttpError, type UserRole } from "../types.js";
import type { Actor } from "../users.js";

export type ReviewStatus = "pending" | "approved" | "rejected";
export type ReviewEntityType = "ops_report" | "editor_report" | "fan_report" | "order";
export type ReviewAction = "approve" | "reject";

export const REVIEW_STATUSES: ReviewStatus[] = ["pending", "approved", "rejected"];
export const REVIEW_ENTITY_TYPES: ReviewEntityType[] = [
  "ops_report",
  "editor_report",
  "fan_report",
  "order"
];

export const REVIEW_ENTITY = {
  ops_report: { table: "ops_reports", label: "推广" },
  editor_report: { table: "editor_reports", label: "拍剪" },
  fan_report: { table: "fan_reports", label: "加粉" },
  order: { table: "orders", label: "订单" }
} as const;

export function isAssistant(actor: { role: UserRole }): boolean {
  return actor.role === "assistant";
}

export function canViewReviews(actor: Actor): boolean {
  return actor.role === "assistant" || actor.role === "boss" || actor.role === "admin";
}

export function assertAssistant(actor: Actor): void {
  if (!isAssistant(actor)) {
    throw new HttpError(403, "只有助理可以审核日常填报");
  }
}

export function assertCanViewReviews(actor: Actor): void {
  if (!canViewReviews(actor)) {
    throw new HttpError(403, "无权查看审核列表");
  }
}

export function parseReviewStatus(value: unknown): ReviewStatus {
  const text = String(value ?? "");
  if (!REVIEW_STATUSES.includes(text as ReviewStatus)) {
    throw new HttpError(400, "审核状态无效");
  }
  return text as ReviewStatus;
}

export function parseReviewEntityType(value: unknown): ReviewEntityType {
  const text = String(value ?? "");
  if (!REVIEW_ENTITY_TYPES.includes(text as ReviewEntityType)) {
    throw new HttpError(400, "审核对象类型无效");
  }
  return text as ReviewEntityType;
}

export function reviewPublicFields(row: Record<string, unknown> | undefined) {
  if (!row) return {};
  return {
    reviewStatus: (row.review_status as ReviewStatus) ?? "pending",
    reviewVersion: Number(row.review_version ?? 1),
    lastSubmittedBy: row.last_submitted_by ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewReason: row.review_reason ?? null
  };
}

function assertNotSelfReview(actor: Actor, row: Record<string, unknown>): void {
  const ownerId = String(row.user_id ?? "");
  const submittedBy = String(row.last_submitted_by ?? ownerId);
  if (actor.id === ownerId || actor.id === submittedBy) {
    throw new HttpError(403, "不能审核自己提交或记在自己名下的数据");
  }
}

export async function recordSubmission(
  db: Pool | PoolClient,
  options: {
    table: string;
    entityType: ReviewEntityType;
    id: string;
    actorId: string;
    changed: boolean;
    isNew: boolean;
    ip?: string | null;
  }
): Promise<void> {
  if (!options.changed && !options.isNew) return;
  const existing = await queryOne<Record<string, unknown>>(
    db,
    `SELECT id, review_status, review_version FROM ${options.table} WHERE id = $1`,
    [options.id]
  );
  if (!existing) return;
  const beforeStatus = (existing.review_status as ReviewStatus) ?? "pending";
  const nextVersion = options.isNew ? Number(existing.review_version ?? 1) : Number(existing.review_version ?? 1) + 1;
  await db.query(
    `UPDATE ${options.table}
        SET review_status = 'pending',
            review_version = $2,
            last_submitted_by = $3,
            reviewed_by = NULL,
            reviewed_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [options.id, options.isNew ? Number(existing.review_version ?? 1) : nextVersion, options.actorId]
  );
  if (!options.isNew && (beforeStatus === "approved" || beforeStatus === "rejected")) {
    await db.query(
      `INSERT INTO review_actions (
          entity_type, entity_id, review_version, action, reason, actor_id, before_status, after_status
       ) VALUES ($1, $2, $3, 'resubmitted', NULL, $4, $5, 'pending')`,
      [options.entityType, options.id, nextVersion, options.actorId, beforeStatus]
    );
    await writeAudit(db, {
      actorId: options.actorId,
      action: "review_resubmitted",
      entityType: options.entityType,
      entityId: options.id,
      before: { reviewStatus: beforeStatus, reviewVersion: existing.review_version },
      after: { reviewStatus: "pending", reviewVersion: nextVersion },
      ip: options.ip
    });
  }
}

export async function applyReview(
  db: Pool,
  actor: Actor,
  input: {
    entityType: ReviewEntityType;
    entityId: string;
    action: ReviewAction;
    reason?: string;
    version: number;
    ip?: string | null;
  }
): Promise<Record<string, unknown>> {
  assertAssistant(actor);
  const reason = String(input.reason ?? "").trim();
  if (input.action === "reject" && !reason) {
    throw new HttpError(400, "退回必须填写原因");
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new HttpError(400, "请提供当前审核版本");
  }
  const table = REVIEW_ENTITY[input.entityType].table;
  const afterStatus: ReviewStatus = input.action === "approve" ? "approved" : "rejected";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const row = await queryOne<Record<string, unknown>>(
      client,
      `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`,
      [input.entityId]
    );
    if (!row) throw new HttpError(404, "记录不存在");
    assertNotSelfReview(actor, row);
    if (Number(row.review_version) !== input.version) {
      throw new HttpError(409, "记录已被修改，请刷新后再审核", "review_version_conflict");
    }
    const saved = await queryOne<Record<string, unknown>>(
      client,
      `UPDATE ${table}
          SET review_status = $2,
              reviewed_by = $3,
              reviewed_at = now(),
              review_reason = $4
        WHERE id = $1 AND review_version = $5
        RETURNING *`,
      [input.entityId, afterStatus, actor.id, reason || null, input.version]
    );
    if (!saved) {
      throw new HttpError(409, "记录已被修改，请刷新后再审核", "review_version_conflict");
    }
    await client.query(
      `INSERT INTO review_actions (
          entity_type, entity_id, review_version, action, reason, actor_id, before_status, after_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.entityType,
        input.entityId,
        input.version,
        afterStatus === "approved" ? "approved" : "rejected",
        reason || null,
        actor.id,
        row.review_status,
        afterStatus
      ]
    );
    await writeAudit(client, {
      actorId: actor.id,
      action: afterStatus === "approved" ? "review_approved" : "review_rejected",
      entityType: input.entityType,
      entityId: input.entityId,
      before: { reviewStatus: row.review_status, reviewVersion: row.review_version },
      after: { reviewStatus: afterStatus, reviewVersion: input.version, reason: reason || null },
      ip: input.ip
    });
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listReviewHistory(
  db: Pool | PoolClient,
  entityType: ReviewEntityType,
  entityId: string
): Promise<Record<string, unknown>[]> {
  return query(
    db,
    `SELECT a.id, a.entity_type, a.entity_id, a.review_version, a.action, a.reason,
            a.actor_id, u.display_name AS actor_name, a.before_status, a.after_status, a.created_at
       FROM review_actions a
       JOIN users u ON u.id = a.actor_id
      WHERE a.entity_type = $1 AND a.entity_id = $2
      ORDER BY a.created_at ASC`,
    [entityType, entityId]
  );
}
