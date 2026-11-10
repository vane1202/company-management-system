import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { EDITOR_FIELD_NOTE, OPS_CURRENCY_NOTE, lastSnapshotsThenSum } from "../lib/dailyMetrics.js";
import { businessToday, isIsoDate, toDateOnly } from "../lib/dates.js";
import { parseCount, parseMoney, parsePercent } from "../lib/money.js";
import { recordSubmission, reviewPublicFields } from "../lib/review.js";
import { HttpError } from "../types.js";
import { isBossOrAdmin, type Actor } from "../users.js";
import type { AppConfig } from "../config.js";

export function createOpsRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const userId = resolveListUserId(actor, req.query.userId, "无权查看他人的运营记录");
      const rows = await query(
        db,
        `SELECT * FROM ops_reports
          WHERE ($1::uuid IS NULL OR user_id = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
         ORDER BY business_date DESC, persona_name, platform`,
        [userId, emptyDate(req.query.from), emptyDate(req.query.to)]
      );
      res.json({ reports: rows.map(serializeOps), notes: [OPS_CURRENCY_NOTE] });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role !== "ops" && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只有运营或管理员可以填写推广数据");
      }
      const targetId = String(req.body?.userId ?? actor.id);
      if (targetId !== actor.id && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只能填写本人的运营数据");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const businessDate = String(req.body?.businessDate ?? today);
      if (!isIsoDate(businessDate) || businessDate > today) throw new HttpError(400, "业务日无效");
      const platform = String(req.body?.platform ?? "").trim();
      if (platform.length > 64) throw new HttpError(400, "推广平台过长");
      const personaName = String(req.body?.personaName ?? platform).trim();
      if (personaName.length > 128) throw new HttpError(400, "人设/主页名称过长");
      const adAccountRef = req.body?.adAccountRef ? String(req.body.adAccountRef).trim() : null;
      if(adAccountRef){const a=await queryOne<{opened_on:string}>(db,"SELECT opened_on::text FROM ad_accounts WHERE code=$1",[adAccountRef]);if(!a||businessDate<a.opened_on)throw new HttpError(400,"广告账户不存在或日报早于期初日期");}
      const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        if(req.body?.reportId){
          if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.body.reportId)))throw new HttpError(400,"原日报标识无效");
          const original=await queryOne<Record<string,unknown>>(client,"SELECT * FROM ops_reports WHERE id=$1 FOR UPDATE",[String(req.body.reportId)]);
          if(!original||String(original.user_id)!==targetId)throw new HttpError(404,"原日报不存在或不属于本人");
          if(toDateOnly(original.business_date)!==businessDate||String(original.persona_name)!==personaName)throw new HttpError(400,"更改日期或人设请使用新建日报");
          await client.query("UPDATE ops_reports SET ad_account_ref=$2 WHERE id=$1",[original.id,adAccountRef]);
          if(original.ad_account_ref!==adAccountRef)await writeAudit(client,{actorId:actor.id,action:"ops_account_classification",entityType:"ops_report",entityId:String(original.id),before:{adAccountRef:original.ad_account_ref},after:{adAccountRef},ip:req.ip});
        }
        const existing = await queryOne<Record<string, unknown>>(
          client,
          `SELECT * FROM ops_reports
            WHERE user_id = $1 AND business_date = $2 AND persona_name = $3 AND ad_account_ref IS NOT DISTINCT FROM $4
            FOR UPDATE`,
          [targetId, businessDate, personaName, adAccountRef]
        );
        const promoVideoCount = readCount(req.body, "promoVideoCount", "推广视频数", existing, "promo_video_count", 0);
        const promoCost = readMoney(req.body, "promoCost", "推广费用", existing, "promo_cost", "0.00");
        const spendUsd = readOptionalMoney(req.body, "spendUsd", "美元花费", existing, "spend_usd");
        const consultCount = readOptionalCount(req.body, "consultCount", "咨询数", existing, "consult_count");
        const consultCostUsd = readOptionalMoney(req.body, "consultCostUsd", "每次咨询成本", existing, "consult_cost_usd");
        const clickCount = readOptionalCount(req.body, "clickCount", "点击量", existing, "click_count", 100_000_000);
        const ctrPercent = readOptionalPercent(req.body, "ctrPercent", "点击率", existing, "ctr_percent");
        const balanceUsd = readOptionalMoney(req.body, "balanceUsd", "余额快照", existing, "balance_usd");
        const unchanged = Boolean(
          existing &&
            Number(existing.promo_video_count) === promoVideoCount &&
            Number(existing.promo_cost) === Number(promoCost) &&
            nullableNumber(existing.spend_usd) === nullableNumber(spendUsd) &&
            nullableNumber(existing.consult_count) === nullableNumber(consultCount) &&
            nullableNumber(existing.consult_cost_usd) === nullableNumber(consultCostUsd) &&
            nullableNumber(existing.click_count) === nullableNumber(clickCount) &&
            nullableNumber(existing.ctr_percent) === nullableNumber(ctrPercent) &&
            nullableNumber(existing.balance_usd) === nullableNumber(balanceUsd) &&
            (existing.note ?? null) === note
        );
        if (existing && unchanged) {
          await client.query("COMMIT");
          res.json({ report: serializeOps(existing) });
          return;
        }
        const saved = existing
          ? await queryOne(
              client,
              `UPDATE ops_reports
                  SET platform = $2, promo_video_count = $3, promo_cost = $4, note = $5,
                      spend_usd = $6, consult_count = $7, consult_cost_usd = $8,
                      click_count = $9, ctr_percent = $10, balance_usd = $11, updated_at = now()
                WHERE id = $1
                RETURNING *`,
              [
                existing.id,
                platform || String(existing.platform ?? ""),
                promoVideoCount,
                promoCost,
                note,
                spendUsd,
                consultCount,
                consultCostUsd,
                clickCount,
                ctrPercent,
                balanceUsd
              ]
            )
          : await queryOne(
              client,
              `INSERT INTO ops_reports (
                  user_id, business_date, platform, persona_name, promo_video_count, promo_cost, note,
                  spend_usd, consult_count, consult_cost_usd, click_count, ctr_percent, balance_usd, last_submitted_by, ad_account_ref
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               RETURNING *`,
              [
                targetId,
                businessDate,
                platform,
                personaName,
                promoVideoCount,
                promoCost,
                note,
                spendUsd,
                consultCount,
                consultCostUsd,
                clickCount,
                ctrPercent,
                balanceUsd,
                actor.id,
                adAccountRef
              ]
            );
        if(saved)await client.query("UPDATE ops_reports SET ad_account_ref=$2 WHERE id=$1",[saved.id,adAccountRef]);
        await recordSubmission(client, {
          table: "ops_reports",
          entityType: "ops_report",
          id: String(saved!.id),
          actorId: actor.id,
          changed: true,
          isNew: !existing,
          ip: req.ip
        });
        await writeAudit(client, {
          actorId: actor.id,
          action: "ops_report_upsert",
          entityType: "ops_report",
          entityId: String(saved!.id),
          after: {
            businessDate,
            platform,
            personaName,
            promoVideoCount,
            promoCost,
            spendUsd,
            consultCount,
            consultCostUsd,
            clickCount,
            ctrPercent,
            balanceUsd
          },
          ip: req.ip
        });
        const fresh = await queryOne(client, "SELECT * FROM ops_reports WHERE id = $1", [saved!.id]);
        await client.query("COMMIT");
        res.json({ report: serializeOps(fresh) });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createEditorRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const userId = resolveListUserId(actor, req.query.userId, "无权查看他人的拍剪记录");
      const rows = await query(
        db,
        `SELECT * FROM editor_reports
          WHERE ($1::uuid IS NULL OR user_id = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
         ORDER BY business_date DESC, persona_name`,
        [userId, emptyDate(req.query.from), emptyDate(req.query.to)]
      );
      res.json({ reports: rows.map(serializeEditor), notes: [EDITOR_FIELD_NOTE] });
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const targetId = req.query.userId ? String(req.query.userId) : "";
      if (targetId) assertSelfOrBoss(actor, targetId, "无权查看他人拍剪汇总");
      if (!targetId && !isBossOrAdmin(actor) && actor.role !== "editor") {
        throw new HttpError(403, "无权查看拍剪汇总");
      }
      const userFilter = targetId || (actor.role === "editor" ? actor.id : "");
      const from = emptyDate(req.query.from);
      const to = emptyDate(req.query.to);
      const totals = await queryOne<{
        shoot: string;
        finished: string;
        published: string;
        edit_count: string;
        sent_to_ops: string;
      }>(
        db,
        `SELECT COALESCE(SUM(shoot_count),0)::text AS shoot,
                COALESCE(SUM(finished_count),0)::text AS finished,
                COALESCE(SUM(published_count),0)::text AS published,
                COALESCE(SUM(edit_count),0)::text AS edit_count,
                COALESCE(SUM(sent_to_ops_count),0)::text AS sent_to_ops
           FROM editor_reports
          WHERE ($1 = '' OR user_id::text = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)`,
        [userFilter, from, to]
      );
      const latest = await query<{
        user_id: string;
        persona_name: string;
        inventory_snapshot: number;
        business_date: string;
      }>(
        db,
        `SELECT DISTINCT ON (COALESCE(editor_name,user_id::text), persona_name)
                COALESCE(editor_name,user_id::text) AS user_id, persona_name, inventory_snapshot, business_date::text
           FROM editor_reports
          WHERE ($1 = '' OR user_id::text = $1)
            AND ($2::date IS NULL OR business_date >= $2)
            AND ($3::date IS NULL OR business_date <= $3)
          ORDER BY COALESCE(editor_name,user_id::text), persona_name, business_date DESC`,
        [userFilter, from, to]
      );
      const endingInventory = lastSnapshotsThenSum(
        latest.map((row) => ({
          user_id: row.user_id,
          persona_name: row.persona_name,
          business_date: row.business_date,
          value: row.inventory_snapshot
        }))
      );
      res.json({
        shootCount: Number(totals?.shoot ?? 0),
        finishedCount: Number(totals?.finished ?? 0),
        publishedCount: Number(totals?.published ?? 0),
        editCount: Number(totals?.edit_count ?? 0),
        sentToOpsCount: Number(totals?.sent_to_ops ?? 0),
        endingInventory,
        inventoryMethod: "ending_snapshots_per_persona",
        note: EDITOR_FIELD_NOTE
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role !== "editor" && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只有拍剪或管理员可以填写拍剪数据");
      }
      const targetId = String(req.body?.userId ?? actor.id);
      if (targetId !== actor.id && !isBossOrAdmin(actor)) {
        throw new HttpError(403, "只能填写本人的拍剪数据");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const businessDate = String(req.body?.businessDate ?? today);
      if (!isIsoDate(businessDate) || businessDate > today) throw new HttpError(400, "业务日无效");
      const personaName = String(req.body?.personaName ?? "").trim();
      if (personaName.length > 128) throw new HttpError(400, "人设名称过长");
      const editorName=req.body?.editorName ? String(req.body.editorName).trim() : null;
      if(editorName&&!["魏磊","尚杰","十七"].includes(editorName))throw new HttpError(400,"拍剪师无效");
      const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
      const previous = await queryOne<{ inventory_snapshot: number }>(
        db,
        `SELECT inventory_snapshot FROM editor_reports
          WHERE user_id = $1 AND persona_name = $2 AND business_date < $3 AND editor_name IS NOT DISTINCT FROM $4
          ORDER BY business_date DESC LIMIT 1`,
        [targetId, personaName, businessDate, editorName]
      );
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        if(req.body?.reportId){
          if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.body.reportId)))throw new HttpError(400,"原日报标识无效");
          const original=await queryOne<Record<string,unknown>>(client,"SELECT * FROM editor_reports WHERE id=$1 FOR UPDATE",[String(req.body.reportId)]);
          if(!original||String(original.user_id)!==targetId)throw new HttpError(404,"原日报不存在或不属于本人");
          if(toDateOnly(original.business_date)!==businessDate||String(original.persona_name)!==personaName)throw new HttpError(400,"更改日期或人设请使用新建日报");
          await client.query("UPDATE editor_reports SET editor_name=$2 WHERE id=$1",[original.id,editorName]);
          if(original.editor_name!==editorName)await writeAudit(client,{actorId:actor.id,action:"editor_classification",entityType:"editor_report",entityId:String(original.id),before:{editorName:original.editor_name},after:{editorName},ip:req.ip});
        }
        const existing = await queryOne<Record<string, unknown>>(
          client,
          `SELECT * FROM editor_reports WHERE user_id = $1 AND business_date = $2 AND persona_name = $3 AND editor_name IS NOT DISTINCT FROM $4 FOR UPDATE`,
          [targetId, businessDate, personaName, editorName]
        );
        const shootCount = readCount(req.body, "shootCount", "拍摄数", existing, "shoot_count", 0);
        const finishedCount = readCount(req.body, "finishedCount", "成片数", existing, "finished_count", 0);
        const publishedCount = readCount(req.body, "publishedCount", "已发布数", existing, "published_count", 0);
        const inventorySnapshot = readCount(req.body, "inventorySnapshot", "视频囤量", existing, "inventory_snapshot", 0, 10_000_000);
        const editCount = readOptionalCount(req.body, "editCount", "剪辑条数", existing, "edit_count");
        const sentToOpsCount = readOptionalCount(req.body, "sentToOpsCount", "发给运营条数", existing, "sent_to_ops_count");
        const suggested = (previous?.inventory_snapshot ?? 0) + finishedCount - publishedCount;
        const adjusted = inventorySnapshot !== suggested;
        const unchanged = Boolean(
          existing &&
            Number(existing.shoot_count) === shootCount &&
            Number(existing.finished_count) === finishedCount &&
            Number(existing.published_count) === publishedCount &&
            Number(existing.inventory_snapshot) === inventorySnapshot &&
            nullableNumber(existing.edit_count) === nullableNumber(editCount) &&
            nullableNumber(existing.sent_to_ops_count) === nullableNumber(sentToOpsCount) &&
            (existing.note ?? null) === note
        );
        if (existing && unchanged) {
          await client.query("COMMIT");
          res.json({ report: serializeEditor(existing), suggestedInventory: suggested });
          return;
        }
        const saved = existing
          ? await queryOne(
              client,
              `UPDATE editor_reports
                  SET shoot_count = $2, finished_count = $3, published_count = $4,
                      inventory_snapshot = $5, inventory_adjusted = $6, note = $7,
                      edit_count = $8, sent_to_ops_count = $9, updated_at = now()
                WHERE id = $1
                RETURNING *`,
              [
                existing.id,
                shootCount,
                finishedCount,
                publishedCount,
                inventorySnapshot,
                adjusted,
                note,
                editCount,
                sentToOpsCount
              ]
            )
          : await queryOne(
              client,
              `INSERT INTO editor_reports (
                  user_id, business_date, persona_name, shoot_count, finished_count, published_count,
                  inventory_snapshot, inventory_adjusted, note, edit_count, sent_to_ops_count, last_submitted_by, editor_name
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               RETURNING *`,
              [
                targetId,
                businessDate,
                personaName,
                shootCount,
                finishedCount,
                publishedCount,
                inventorySnapshot,
                adjusted,
                note,
                editCount,
                sentToOpsCount,
                actor.id,
                editorName
              ]
            );
        await recordSubmission(client, {
          table: "editor_reports",
          entityType: "editor_report",
          id: String(saved!.id),
          actorId: actor.id,
          changed: true,
          isNew: !existing,
          ip: req.ip
        });
        await writeAudit(client, {
          actorId: actor.id,
          action: "editor_report_upsert",
          entityType: "editor_report",
          entityId: String(saved!.id),
          after: {
            businessDate,
            personaName,
            shootCount,
            finishedCount,
            publishedCount,
            editCount,
            sentToOpsCount,
            inventorySnapshot,
            suggested,
            adjusted
          },
          ip: req.ip
        });
        const fresh = await queryOne(client, "SELECT * FROM editor_reports WHERE id = $1", [saved!.id]);
        await client.query("COMMIT");
        res.json({ report: serializeEditor(fresh), suggestedInventory: suggested });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function assertSelfOrBoss(actor: Actor, targetId: string, message: string) {
  if (actor.id !== targetId && !isBossOrAdmin(actor)) {
    throw new HttpError(403, message);
  }
}

function emptyDate(value: unknown): string | null {
  const text = String(value ?? "");
  return text && isIsoDate(text) ? text : null;
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function readCount(
  body: Record<string, unknown>,
  key: string,
  field: string,
  existing: Record<string, unknown> | undefined,
  existingKey: string,
  fallback: number,
  max?: number
): number {
  if (hasOwn(body, key)) return parseCount(body[key], field, max);
  if (existing && existing[existingKey] != null) return Number(existing[existingKey]);
  return fallback;
}

function readOptionalCount(
  body: Record<string, unknown>,
  key: string,
  field: string,
  existing: Record<string, unknown> | undefined,
  existingKey: string,
  max?: number
): number | null {
  if (hasOwn(body, key)) {
    if (body[key] == null || body[key] === "") return null;
    return parseCount(body[key], field, max);
  }
  if (existing && existing[existingKey] != null) return Number(existing[existingKey]);
  return null;
}

function readMoney(
  body: Record<string, unknown>,
  key: string,
  field: string,
  existing: Record<string, unknown> | undefined,
  existingKey: string,
  fallback: string
): string {
  if (hasOwn(body, key)) return parseMoney(body[key], field);
  if (existing && existing[existingKey] != null) return Number(existing[existingKey]).toFixed(2);
  return fallback;
}

function readOptionalMoney(
  body: Record<string, unknown>,
  key: string,
  field: string,
  existing: Record<string, unknown> | undefined,
  existingKey: string
): string | null {
  if (hasOwn(body, key)) {
    if (body[key] == null || body[key] === "") return null;
    return parseMoney(body[key], field);
  }
  if (existing && existing[existingKey] != null) return Number(existing[existingKey]).toFixed(2);
  return null;
}

function readOptionalPercent(
  body: Record<string, unknown>,
  key: string,
  field: string,
  existing: Record<string, unknown> | undefined,
  existingKey: string
): string | null {
  if (hasOwn(body, key)) {
    if (body[key] == null || body[key] === "") return null;
    return parsePercent(body[key], field);
  }
  if (existing && existing[existingKey] != null) return Number(existing[existingKey]).toFixed(2);
  return null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function serializeOps(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    businessDate: toDateOnly(row.business_date),
    platform: row.platform,
    personaName: row.persona_name ?? "",
    adAccountRef: row.ad_account_ref,
    promoVideoCount: row.promo_video_count,
    promoCost: money(row.promo_cost),
    promoCostCurrency: "unknown_legacy",
    spendUsd: row.spend_usd == null ? null : money(row.spend_usd),
    spendCurrency: "USD",
    consultCount: row.consult_count,
    consultCostUsd: row.consult_cost_usd == null ? null : money(row.consult_cost_usd),
    clickCount: row.click_count,
    ctrPercent: row.ctr_percent == null ? null : Number(row.ctr_percent).toFixed(2),
    balanceUsd: row.balance_usd == null ? null : money(row.balance_usd),
    note: row.note,
    currencyNote: OPS_CURRENCY_NOTE,
    updatedAt: row.updated_at,
    ...reviewPublicFields(row)
  };
}

function serializeEditor(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    businessDate: toDateOnly(row.business_date),
    personaName: row.persona_name ?? "",
    editorName: row.editor_name ?? null,
    shootCount: row.shoot_count,
    finishedCount: row.finished_count,
    publishedCount: row.published_count,
    editCount: row.edit_count,
    sentToOpsCount: row.sent_to_ops_count,
    inventorySnapshot: row.inventory_snapshot,
    inventoryAdjusted: row.inventory_adjusted,
    note: row.note,
    fieldNote: EDITOR_FIELD_NOTE,
    updatedAt: row.updated_at,
    ...reviewPublicFields(row)
  };
}

function resolveListUserId(actor: Actor, raw: unknown, message: string): string | null {
  const requested = raw ? String(raw) : "";
  if (requested) {
    assertSelfOrBoss(actor, requested, message);
    return requested;
  }
  if (isBossOrAdmin(actor)) return null;
  return actor.id;
}

function money(value: unknown): string {
  return Number(value).toFixed(2);
}
