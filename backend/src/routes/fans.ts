import { Router } from "express";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { businessToday, diffDays, isIsoDate, toDateOnly } from "../lib/dates.js";
import { parseCount } from "../lib/money.js";
import { getBackfillDays } from "../settings.js";
import { HttpError } from "../types.js";
import {
  assertTeamScope,
  isBossOrAdmin,
  managedTeamIds,
  membersOnDate,
  membershipOnDate,
  requireUser,
  type Actor
} from "../users.js";
import type { AppConfig } from "../config.js";

export function createFanRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/me", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      const params: unknown[] = [actor.id];
      let sql = `SELECT id, user_id, team_id, business_date, added_count, created_at, updated_at
                   FROM fan_reports WHERE user_id = $1`;
      if (from && isIsoDate(from)) {
        params.push(from);
        sql += ` AND business_date >= $${params.length}`;
      }
      if (to && isIsoDate(to)) {
        params.push(to);
        sql += ` AND business_date <= $${params.length}`;
      }
      sql += " ORDER BY business_date DESC";
      const rows = await query(db, sql, params);
      res.json({ reports: rows.map(serializeFan) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const today = businessToday(new Date(), config.businessTimezone);
      const businessDate = String(req.body?.businessDate ?? today);
      if (!isIsoDate(businessDate)) throw new HttpError(400, "业务日格式无效");
      const addedCount = parseCount(req.body?.addedCount, "加粉数");
      const targetUserId = String(req.body?.userId ?? actor.id);
      await assertCanWriteFan(db, actor, targetUserId, businessDate, today, config);
      const membership = await membershipOnDate(db, targetUserId, businessDate);
      if (!membership) throw new HttpError(400, "该员工在此业务日没有小组归属，请先维护成员历史");

      const existing = await queryOne<{
        id: string;
        added_count: number;
        team_id: string;
        business_date: string;
        user_id: string;
      }>(db, "SELECT * FROM fan_reports WHERE user_id = $1 AND business_date = $2", [
        targetUserId,
        businessDate
      ]);

      if (!existing) {
        const inserted = await queryOne(
          db,
          `INSERT INTO fan_reports (user_id, team_id, business_date, added_count)
           VALUES ($1, $2, $3, $4)
           RETURNING id, user_id, team_id, business_date, added_count, created_at, updated_at`,
          [targetUserId, membership.team_id, businessDate, addedCount]
        );
        await writeAudit(db, {
          actorId: actor.id,
          action: "fan_report_create",
          entityType: "fan_report",
          entityId: inserted!.id,
          after: { addedCount, businessDate, userId: targetUserId, teamId: membership.team_id },
          ip: req.ip
        });
        res.json({ report: serializeFan(inserted), revised: false });
        return;
      }

      if (existing.added_count === addedCount) {
        res.json({
          report: serializeFan(
            await queryOne(db, "SELECT * FROM fan_reports WHERE id = $1", [existing.id])
          ),
          revised: false
        });
        return;
      }

      await db.query(
        "UPDATE fan_reports SET added_count = $1, updated_at = now() WHERE id = $2",
        [addedCount, existing.id]
      );
      await db.query(
        `INSERT INTO fan_report_revisions (report_id, previous_count, new_count, changed_by)
         VALUES ($1, $2, $3, $4)`,
        [existing.id, existing.added_count, addedCount, actor.id]
      );
      await writeAudit(db, {
        actorId: actor.id,
        action: "fan_report_revise",
        entityType: "fan_report",
        entityId: existing.id,
        before: { addedCount: existing.added_count },
        after: { addedCount },
        ip: req.ip
      });
      const updated = await queryOne(db, "SELECT * FROM fan_reports WHERE id = $1", [existing.id]);
      res.json({ report: serializeFan(updated), revised: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/summary", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role === "cs" || actor.role === "ops" || actor.role === "editor") {
        throw new HttpError(403, "无权查看加粉汇总");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const date = String(req.query.date ?? today);
      if (!isIsoDate(date)) throw new HttpError(400, "业务日格式无效");
      const requestedTeam = req.query.teamId ? String(req.query.teamId) : "";
      const visible = await managedTeamIds(db, actor);
      if (requestedTeam) await assertTeamScope(db, actor, requestedTeam);
      const teamIds = requestedTeam ? [requestedTeam] : visible;
      const teams = teamIds.length
        ? await query<{ id: string; name: string }>(
            db,
            `SELECT id, name FROM teams WHERE id = ANY($1::uuid[]) ORDER BY name`,
            [teamIds]
          )
        : [];

      const summaries = [];
      for (const team of teams) {
        const members = await membersOnDate(db, team.id, date);
        const reports = members.length
          ? await query<{ user_id: string; added_count: number; updated_at: string }>(
              db,
              `SELECT user_id, added_count, updated_at
                 FROM fan_reports
                WHERE business_date = $1 AND user_id = ANY($2::uuid[])`,
              [date, members.map((item) => item.user_id)]
            )
          : [];
        const reportMap = new Map(reports.map((item) => [item.user_id, item]));
        const details = members.map((member) => {
          const report = reportMap.get(member.user_id);
          return {
            userId: member.user_id,
            displayName: member.display_name,
            username: member.username,
            addedCount: report ? report.added_count : null,
            status: report ? "reported" : "missing",
            updatedAt: report?.updated_at ?? null
          };
        });
        const reported = details.filter((item) => item.status === "reported");
        summaries.push({
          teamId: team.id,
          teamName: team.name,
          totalAdded: reported.reduce((sum, item) => sum + Number(item.addedCount ?? 0), 0),
          expectedCount: details.length,
          reportedCount: reported.length,
          missingCount: details.length - reported.length,
          missing: details.filter((item) => item.status === "missing").map((item) => ({
            userId: item.userId,
            displayName: item.displayName
          })),
          details
        });
      }
      res.json({ date, teams: summaries });
    } catch (error) {
      next(error);
    }
  });

  router.get("/export", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role === "cs" || actor.role === "ops" || actor.role === "editor") {
        throw new HttpError(403, "无权导出加粉汇总");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const date = String(req.query.date ?? today);
      if (!isIsoDate(date)) throw new HttpError(400, "业务日格式无效");
      const requestedTeam = req.query.teamId ? String(req.query.teamId) : "";
      if (requestedTeam) await assertTeamScope(db, actor, requestedTeam);
      const visible = requestedTeam ? [requestedTeam] : await managedTeamIds(db, actor);
      const rows = visible.length
        ? await query<{
            team_name: string;
            display_name: string;
            username: string;
            added_count: number | null;
          }>(
            db,
            `SELECT t.name AS team_name, u.display_name, u.username, fr.added_count
               FROM team_memberships m
               JOIN teams t ON t.id = m.team_id
               JOIN users u ON u.id = m.user_id
               LEFT JOIN fan_reports fr
                 ON fr.user_id = u.id AND fr.business_date = $1
              WHERE m.team_id = ANY($2::uuid[])
                AND m.start_date <= $1::date
                AND (m.end_date IS NULL OR m.end_date >= $1::date)
              ORDER BY t.name, u.display_name`,
            [date, visible]
          )
        : [];
      const lines = ["业务日,小组,姓名,登录名,加粉数,状态"];
      for (const row of rows) {
        const status = row.added_count === null ? "未报" : "已报";
        const count = row.added_count === null ? "" : String(row.added_count);
        lines.push(`${date},${csv(row.team_name)},${csv(row.display_name)},${csv(row.username)},${count},${status}`);
      }
      const body = `\uFEFF${lines.join("\n")}`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fan-summary-${date}.csv"`);
      res.send(body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:reportId/revisions", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const report = await queryOne<{ id: string; user_id: string; team_id: string; business_date: string }>(
        db,
        "SELECT id, user_id, team_id, business_date FROM fan_reports WHERE id = $1",
        [req.params.reportId]
      );
      if (!report) throw new HttpError(404, "记录不存在");
      await assertCanReadFan(db, actor, report.user_id, report.team_id);
      const revisions = await query(
        db,
        `SELECT r.id, r.previous_count, r.new_count, r.created_at,
                u.display_name AS changed_by_name
           FROM fan_report_revisions r
           JOIN users u ON u.id = r.changed_by
          WHERE r.report_id = $1
          ORDER BY r.created_at ASC`,
        [report.id]
      );
      res.json({
        revisions: revisions.map((item) => ({
          id: item.id,
          previousCount: item.previous_count,
          newCount: item.new_count,
          createdAt: item.created_at,
          changedByName: item.changed_by_name
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function serializeFan(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    teamId: row.team_id,
    businessDate: toDateOnly(row.business_date),
    addedCount: row.added_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

async function assertCanWriteFan(
  db: Pool,
  actor: Actor,
  targetUserId: string,
  businessDate: string,
  today: string,
  config: AppConfig
): Promise<void> {
  if (businessDate > today) throw new HttpError(400, "不能填报未来日期");
  const backfillDays = await getBackfillDays(db, config.fanReportBackfillDays);
  const delta = diffDays(businessDate, today);
  const inWindow = delta >= 0 && delta < backfillDays;

  if (actor.id === targetUserId && (actor.role === "cs" || actor.role === "cs_supervisor")) {
    if (!inWindow) throw new HttpError(403, `仅可填报近 ${backfillDays} 个业务日（含今天）`);
    return;
  }
  if (isBossOrAdmin(actor)) return;
  if (actor.role === "cs_supervisor") {
    const target = await requireUser(db, targetUserId);
    const membership = await membershipOnDate(db, target.id, businessDate);
    if (!membership) throw new HttpError(403, "无法确定该员工当日小组");
    await assertTeamScope(db, actor, membership.team_id);
    return;
  }
  throw new HttpError(403, "只能填报本人的加粉数据");
}

async function assertCanReadFan(db: Pool, actor: Actor, userId: string, teamId: string | null): Promise<void> {
  if (actor.id === userId || isBossOrAdmin(actor)) return;
  if (actor.role === "cs_supervisor" && teamId) {
    await assertTeamScope(db, actor, teamId);
    return;
  }
  throw new HttpError(403, "无权查看该加粉记录");
}
