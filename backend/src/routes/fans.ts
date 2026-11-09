import { Router } from "express";
import { parseAccountId } from "../lib/csAccounts.js";
import type { Pool } from "pg";
import { writeAudit } from "../audit.js";
import { query, queryOne } from "../db.js";
import { businessToday, diffDays, isIsoDate, toDateOnly } from "../lib/dates.js";
import {
  FAN_STATS_INCOMPLETE_NOTE,
  fanDetailFieldsEqual,
  fanRowIsLegacyUnclassified,
  fanTodayIncrement,
  lastMonthCumulative,
  summarizeFanRows,
  type FanMetricRow
} from "../lib/dailyMetrics.js";
import { parseCount } from "../lib/money.js";
import { recordSubmission, reviewPublicFields } from "../lib/review.js";
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

const COMM_SCOPE_NOTE = "四类沟通状态（正常沟通回复 / 已读不回 / 未读 / 无效粉）统计的是当天新增客户，不含历史存量。四类是否互斥、是否必须合计等于当日进粉，以及今日有效与四类的关系尚未确认，系统不做强约束。";

export function createFanRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/me", async (req, res, next) => {
    try {
      const actor = req.actor!;
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      const params: unknown[] = [actor.id];
      let sql = `SELECT *
                   FROM fan_reports WHERE user_id = $1`;
      if (from && isIsoDate(from)) {
        params.push(from);
        sql += ` AND business_date >= $${params.length}`;
      }
      if (to && isIsoDate(to)) {
        params.push(to);
        sql += ` AND business_date <= $${params.length}`;
      }
      sql += " ORDER BY business_date DESC, page_name ASC";
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
      const payload = parseFanWritePayload(req.body);
      const targetUserId = String(req.body?.userId ?? actor.id);
      await assertCanWriteFan(db, actor, targetUserId, businessDate, today, config);
      const membership = await membershipOnDate(db, targetUserId, businessDate);
      if (!membership) throw new HttpError(400, "该员工在此业务日没有小组归属，请先维护成员历史");

      const existing = await queryOne<Record<string, unknown>>(
        db,
        "SELECT * FROM fan_reports WHERE user_id = $1 AND business_date = $2 AND page_name = $3",
        [targetUserId, businessDate, payload.pageName]
      );

      if (!existing) {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const inserted = await queryOne(
            client,
            `INSERT INTO fan_reports (
                user_id, team_id, business_date, added_count, page_name,
                ms_today, ws_today, ms_month, ws_month, valid_today,
                comm_replied, comm_read_no_reply, comm_unread, comm_invalid, note, last_submitted_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING *`,
            [
              targetUserId,
              membership.team_id,
              businessDate,
              payload.addedCount,
              payload.pageName,
              payload.msToday,
              payload.wsToday,
              payload.msMonth,
              payload.wsMonth,
              payload.validToday,
              payload.commReplied,
              payload.commReadNoReply,
              payload.commUnread,
              payload.commInvalid,
              payload.note,
              actor.id
            ]
          );
          await recordSubmission(client, {
            table: "fan_reports",
            entityType: "fan_report",
            id: String(inserted!.id),
            actorId: actor.id,
            changed: true,
            isNew: true,
            ip: req.ip
          });
          await writeAudit(client, {
            actorId: actor.id,
            action: "fan_report_create",
            entityType: "fan_report",
            entityId: inserted!.id,
            after: fanAuditPayload(payload, businessDate, targetUserId, membership.team_id),
            ip: req.ip
          });
          const fresh = await queryOne(client, "SELECT * FROM fan_reports WHERE id = $1", [inserted!.id]);
          await client.query("COMMIT");
          res.json({ report: serializeFan(fresh), revised: false });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        return;
      }

      if (sameFanPayload(existing, payload)) {
        res.json({
          report: serializeFan(
            await queryOne(db, "SELECT * FROM fan_reports WHERE id = $1", [existing.id])
          ),
          revised: false
        });
        return;
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const locked = await queryOne<Record<string, unknown>>(
          client,
          "SELECT * FROM fan_reports WHERE id = $1 FOR UPDATE",
          [existing.id]
        );
        if (!locked) throw new HttpError(404, "记录不存在");
        await client.query(
          `UPDATE fan_reports
              SET added_count = $1,
                  ms_today = $2,
                  ws_today = $3,
                  ms_month = $4,
                  ws_month = $5,
                  valid_today = $6,
                  comm_replied = $7,
                  comm_read_no_reply = $8,
                  comm_unread = $9,
                  comm_invalid = $10,
                  note = $11,
                  updated_at = now()
            WHERE id = $12`,
          [
            payload.addedCount,
            payload.msToday,
            payload.wsToday,
            payload.msMonth,
            payload.wsMonth,
            payload.validToday,
            payload.commReplied,
            payload.commReadNoReply,
            payload.commUnread,
            payload.commInvalid,
            payload.note,
            locked.id
          ]
        );
        const previousIncrement = fanTodayIncrement(locked as FanMetricRow);
        const nextIncrement = fanTodayIncrement({
          user_id: String(locked.user_id),
          business_date: businessDate,
          added_count: payload.addedCount,
          ms_today: payload.msToday,
          ws_today: payload.wsToday
        });
        await client.query(
          `INSERT INTO fan_report_revisions (report_id, previous_count, new_count, changed_by)
           VALUES ($1, $2, $3, $4)`,
          [locked.id, previousIncrement, nextIncrement, actor.id]
        );
        await recordSubmission(client, {
          table: "fan_reports",
          entityType: "fan_report",
          id: String(existing.id),
          actorId: actor.id,
          changed: true,
          isNew: false,
          ip: req.ip
        });
        await writeAudit(client, {
          actorId: actor.id,
          action: "fan_report_revise",
          entityType: "fan_report",
          entityId: String(existing.id),
          before: serializeFan(existing),
          after: fanAuditPayload(payload, businessDate, targetUserId, membership.team_id),
          ip: req.ip
        });
        const updated = await queryOne(client, "SELECT * FROM fan_reports WHERE id = $1", [existing.id]);
        await client.query("COMMIT");
        res.json({ report: serializeFan(updated), revised: true });
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

  router.get("/summary", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role === "cs" || actor.role === "ops" || actor.role === "editor" || actor.role === "assistant") {
        throw new HttpError(403, "无权查看加粉汇总");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const date = String(req.query.date ?? today);
      if (!isIsoDate(date)) throw new HttpError(400, "业务日格式无效");
      const requestedTeam = req.query.teamId ? String(req.query.teamId) : "";
      if (requestedTeam) await assertTeamScope(db, actor, requestedTeam);
      const accountId = req.query.accountId ? parseAccountId(req.query.accountId) : "";
      const summaries = await buildFanSummaries(db, actor, date, requestedTeam, accountId);
      res.json({ date, teams: summaries, notes: [COMM_SCOPE_NOTE, FAN_STATS_INCOMPLETE_NOTE] });
    } catch (error) {
      next(error);
    }
  });

  router.get("/export", async (req, res, next) => {
    try {
      const actor = req.actor!;
      if (actor.role === "cs" || actor.role === "ops" || actor.role === "editor" || actor.role === "assistant") {
        throw new HttpError(403, "无权导出加粉汇总");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const date = String(req.query.date ?? today);
      if (!isIsoDate(date)) throw new HttpError(400, "业务日格式无效");
      const requestedTeam = req.query.teamId ? String(req.query.teamId) : "";
      if (requestedTeam) await assertTeamScope(db, actor, requestedTeam);
      const accountId = req.query.accountId ? parseAccountId(req.query.accountId) : "";
      const summaries = await buildFanSummaries(db, actor, date, requestedTeam, accountId);
      const lines = ["业务日,小组,姓名,登录名,加粉数,状态"];
      for (const team of summaries) {
        for (const row of team.details) {
          const status = row.status === "reported" ? "已报" : "未报";
          const count = row.addedCount === null ? "" : String(row.addedCount);
          lines.push(`${date},${csv(team.teamName)},${csv(row.displayName)},${csv(row.username)},${count},${status}`);
        }
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

type FanWritePayload = {
  pageName: string;
  addedCount: number;
  msToday: number | null;
  wsToday: number | null;
  msMonth: number | null;
  wsMonth: number | null;
  validToday: number | null;
  commReplied: number | null;
  commReadNoReply: number | null;
  commUnread: number | null;
  commInvalid: number | null;
  note: string | null;
  detailed: boolean;
};

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function parseOptionalNote(input: unknown): string | null {
  if (input == null) return null;
  const value = String(input).trim();
  if (value.length > 500) throw new HttpError(400, "备注最多 500 字，请勿填写不必要的联系方式或客户账号");
  return value;
}

function parseFanWritePayload(body: Record<string, unknown>): FanWritePayload {
  const pageName = String(body?.pageName ?? "").trim();
  if (pageName.length > 128) throw new HttpError(400, "主页全名过长");
  const detailedKeys = [
    "msToday",
    "wsToday",
    "msMonth",
    "wsMonth",
    "validToday",
    "commReplied",
    "commReadNoReply",
    "commUnread",
    "commInvalid",
    "note"
  ];
  const hasDetailedFields = detailedKeys.some((key) => hasOwn(body, key));
  const detailed = Boolean(pageName) || hasDetailedFields;
  if (hasDetailedFields && !pageName) {
    throw new HttpError(400, "请填写主页全名；同一人同一天的多个主页需分别保存，不能互相覆盖");
  }
  if (!detailed) {
    return {
      pageName: "",
      addedCount: parseCount(body?.addedCount, "加粉数"),
      msToday: null,
      wsToday: null,
      msMonth: null,
      wsMonth: null,
      validToday: null,
      commReplied: null,
      commReadNoReply: null,
      commUnread: null,
      commInvalid: null,
      note: null,
      detailed: false
    };
  }
  return {
    pageName,
    addedCount: 0,
    msToday: parseCount(body?.msToday ?? 0, "Messenger今日进粉"),
    wsToday: parseCount(body?.wsToday ?? 0, "WhatsApp今日进粉"),
    msMonth: parseCount(body?.msMonth ?? 0, "Messenger本月进粉"),
    wsMonth: parseCount(body?.wsMonth ?? 0, "WhatsApp本月进粉"),
    validToday: parseCount(body?.validToday ?? 0, "今日有效数"),
    commReplied: parseCount(body?.commReplied ?? 0, "正常沟通回复"),
    commReadNoReply: parseCount(body?.commReadNoReply ?? 0, "已读不回"),
    commUnread: parseCount(body?.commUnread ?? 0, "未读"),
    commInvalid: parseCount(body?.commInvalid ?? 0, "无效粉"),
    note: parseOptionalNote(body?.note) ?? "",
    detailed: true
  };
}

function sameFanPayload(existing: Record<string, unknown>, payload: FanWritePayload): boolean {
  return fanDetailFieldsEqual(
    {
      added_count: existing.added_count,
      page_name: existing.page_name,
      ms_today: existing.ms_today,
      ws_today: existing.ws_today,
      ms_month: existing.ms_month,
      ws_month: existing.ws_month,
      valid_today: existing.valid_today,
      comm_replied: existing.comm_replied,
      comm_read_no_reply: existing.comm_read_no_reply,
      comm_unread: existing.comm_unread,
      comm_invalid: existing.comm_invalid,
      note: existing.note as string | null
    },
    {
      added_count: payload.addedCount,
      page_name: payload.pageName,
      ms_today: payload.msToday,
      ws_today: payload.wsToday,
      ms_month: payload.msMonth,
      ws_month: payload.wsMonth,
      valid_today: payload.validToday,
      comm_replied: payload.commReplied,
      comm_read_no_reply: payload.commReadNoReply,
      comm_unread: payload.commUnread,
      comm_invalid: payload.commInvalid,
      note: payload.note
    }
  );
}

function fanAuditPayload(payload: FanWritePayload, businessDate: string, userId: string, teamId: string) {
  return {
    addedCount: payload.addedCount,
    businessDate,
    userId,
    teamId,
    pageName: payload.pageName,
    msToday: payload.msToday,
    wsToday: payload.wsToday,
    msMonth: payload.msMonth,
    wsMonth: payload.wsMonth,
    validToday: payload.validToday,
    commReplied: payload.commReplied,
    commReadNoReply: payload.commReadNoReply,
    commUnread: payload.commUnread,
    commInvalid: payload.commInvalid,
    note: payload.note
  };
}

type FanPageDetail = {
  reportId: string;
  pageName: string;
  isLegacyUnclassified: boolean;
  addedCount: number;
  msToday: number | null;
  wsToday: number | null;
  msMonth: number | null;
  wsMonth: number | null;
  validToday: number | null;
  commReplied: number | null;
  commReadNoReply: number | null;
  commUnread: number | null;
  commInvalid: number | null;
  note: string | null;
  updatedAt: string | null;
};

type FanDetail = {
  userId: string;
  displayName: string;
  username: string;
  addedCount: number | null;
  status: "reported" | "missing";
  updatedAt: string | null;
  pages: FanPageDetail[];
  legacyUnclassifiedAdded: number;
  statsIncomplete: boolean;
};

type FanTeamSummary = {
  teamId: string;
  teamName: string;
  totalAdded: number;
  expectedCount: number;
  reportedCount: number;
  missingCount: number;
  missing: { userId: string; displayName: string }[];
  details: FanDetail[];
  msToday: number;
  wsToday: number;
  msMonth: number;
  wsMonth: number;
  validToday: number;
  commReplied: number;
  commReadNoReply: number;
  commUnread: number;
  commInvalid: number;
  legacyUnclassifiedAdded: number;
  statsIncomplete: boolean;
  notes: string[];
};

async function buildFanSummaries(
  db: Pool,
  actor: Actor,
  date: string,
  requestedTeam: string,
  accountId = ""
): Promise<FanTeamSummary[]> {
  const visible = await managedTeamIds(db, actor);
  const teamIds = requestedTeam ? [requestedTeam] : visible;
  const teams = teamIds.length
    ? await query<{ id: string; name: string }>(
        db,
        `SELECT id, name FROM teams WHERE id = ANY($1::uuid[]) ORDER BY name`,
        [teamIds]
      )
    : [];

  const summaries: FanTeamSummary[] = [];
  for (const team of teams) {
    const members = (await membersOnDate(db, team.id, date)).filter((member) => !accountId || member.user_id === accountId);
    if (accountId && !members.length) continue;
    const reports = members.length
      ? await query<Record<string, unknown>>(
          db,
          `SELECT *
             FROM fan_reports
            WHERE business_date = $1 AND user_id = ANY($2::uuid[])
            ORDER BY page_name ASC`,
          [date, members.map((item) => item.user_id)]
        )
      : [];
    const reportsByUser = new Map<string, Record<string, unknown>[]>();
    for (const report of reports) {
      const userId = String(report.user_id);
      const list = reportsByUser.get(userId) ?? [];
      list.push(report);
      reportsByUser.set(userId, list);
    }
    const details = members.map((member) => {
      const userReports = reportsByUser.get(member.user_id) ?? [];
      const summary = summarizeFanRows(userReports as FanMetricRow[]);
      const pages: FanPageDetail[] = userReports.map((report) => {
        const legacy = fanRowIsLegacyUnclassified(report as FanMetricRow);
        return {
          reportId: String(report.id),
          pageName: String(report.page_name ?? ""),
          isLegacyUnclassified: legacy,
          addedCount: Number(legacy ? report.added_count ?? 0 : fanTodayIncrement(report as FanMetricRow)),
          msToday: report.ms_today == null ? null : Number(report.ms_today),
          wsToday: report.ws_today == null ? null : Number(report.ws_today),
          msMonth: report.ms_month == null ? null : Number(report.ms_month),
          wsMonth: report.ws_month == null ? null : Number(report.ws_month),
          validToday: report.valid_today == null ? null : Number(report.valid_today),
          commReplied: report.comm_replied == null ? null : Number(report.comm_replied),
          commReadNoReply: report.comm_read_no_reply == null ? null : Number(report.comm_read_no_reply),
          commUnread: report.comm_unread == null ? null : Number(report.comm_unread),
          commInvalid: report.comm_invalid == null ? null : Number(report.comm_invalid),
          note: report.note == null ? null : String(report.note),
          updatedAt: report.updated_at ? String(report.updated_at) : null
        };
      });
      const updatedAt = pages.reduce<string | null>((latest, item) => {
        if (!item.updatedAt) return latest;
        if (!latest || item.updatedAt > latest) return item.updatedAt;
        return latest;
      }, null);
      return {
        userId: member.user_id,
        displayName: member.display_name,
        username: member.username,
        accountKind: member.account_kind,
        wechatId: member.wechat_id,
        addedCount: userReports.length ? summary.todayTotal : null,
        status: userReports.length ? ("reported" as const) : ("missing" as const),
        updatedAt,
        pages,
        legacyUnclassifiedAdded: summary.legacyUnclassifiedAdded,
        statsIncomplete: summary.statsIncomplete
      };
    });
    const reported = details.filter((item) => item.status === "reported");
    const allRows = reports as FanMetricRow[];
    const totals = summarizeFanRows(allRows);
    summaries.push({
      teamId: team.id,
      teamName: team.name,
      totalAdded: totals.todayTotal,
      expectedCount: details.length,
      reportedCount: reported.length,
      missingCount: details.length - reported.length,
      missing: details.filter((item) => item.status === "missing").map((item) => ({
        userId: item.userId,
        displayName: item.displayName
      })),
      details,
      msToday: totals.msToday,
      wsToday: totals.wsToday,
      msMonth: lastMonthCumulative(allRows, "ms_month"),
      wsMonth: lastMonthCumulative(allRows, "ws_month"),
      validToday: totals.validToday,
      commReplied: totals.commReplied,
      commReadNoReply: totals.commReadNoReply,
      commUnread: totals.commUnread,
      commInvalid: totals.commInvalid,
      legacyUnclassifiedAdded: totals.legacyUnclassifiedAdded,
      statsIncomplete: totals.statsIncomplete,
      notes: [COMM_SCOPE_NOTE, ...(totals.statsIncomplete ? [FAN_STATS_INCOMPLETE_NOTE] : [])]
    });
  }
  return summaries;
}

function serializeFan(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const legacy = fanRowIsLegacyUnclassified(row as FanMetricRow);
  return {
    id: row.id,
    userId: row.user_id,
    teamId: row.team_id,
    businessDate: toDateOnly(row.business_date),
    addedCount: row.added_count,
    pageName: row.page_name ?? "",
    isLegacyUnclassified: legacy,
    msToday: row.ms_today,
    wsToday: row.ws_today,
    msMonth: row.ms_month,
    wsMonth: row.ws_month,
    validToday: row.valid_today,
    commReplied: row.comm_replied,
    commReadNoReply: row.comm_read_no_reply,
    commUnread: row.comm_unread,
    commInvalid: row.comm_invalid,
    note: row.note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...reviewPublicFields(row)
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
