import { Router } from "express";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { query } from "../db.js";
import { businessToday, diffDays, isIsoDate } from "../lib/dates.js";
import { HttpError } from "../types.js";

export function createSupervisorConsultationRouter(db: Pool, config: AppConfig) {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      const actor = req.actor;
      if (actor?.role !== "cs_supervisor") throw new HttpError(403, "仅客服主管可查看本组咨询成本");
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      const today = businessToday(new Date(), config.businessTimezone);
      if (!isIsoDate(from) || !isIsoDate(to) || from > to || to > today || diffDays(from, to) > 366) {
        throw new HttpError(400, "请选择有效业务日期，最多367天");
      }
      const days = await query(db, `
        WITH scopes AS (
          SELECT ARRAY(SELECT s.team_id FROM supervisor_scopes s JOIN teams t ON t.id=s.team_id
            WHERE s.supervisor_id=$1 AND t.is_active) AS team_ids
        ), visible_sources AS (
          SELECT source.* FROM supervisor_consultation_sources source, scopes
          WHERE source.team_ids <@ scopes.team_ids
        ), dates AS (
          SELECT ($2::date + n) AS day FROM generate_series(0, $3::date - $2::date) AS n
        ), matched AS (
          SELECT r.business_date, r.spend_usd, r.consult_count
          FROM ops_reports r
          LEFT JOIN supervisor_consultation_sources historical ON historical.report_id=r.id
          JOIN visible_sources s ON s.active_dates @> r.business_date AND
            (s.report_id=r.id OR (historical.id IS NULL AND s.ad_account_ref=r.ad_account_ref))
          WHERE r.business_date BETWEEN $2::date AND $3::date
        ), totals AS (
          SELECT business_date, count(*)::int AS reports,
            sum(spend_usd)::text AS spend, sum(consult_count)::float8 AS consultations,
            bool_and(spend_usd IS NOT NULL AND consult_count IS NOT NULL) AS complete
          FROM matched GROUP BY business_date
        )
        SELECT d.day::text AS date, t.spend AS "spendUsd", t.consultations AS "consultCount",
          CASE WHEN t.reports IS NULL THEN
            CASE WHEN EXISTS (SELECT 1 FROM visible_sources s WHERE s.ad_account_ref IS NOT NULL AND s.active_dates @> d.day)
              THEN 'empty' ELSE 'unlinked' END
          WHEN NOT t.complete OR EXISTS (
            SELECT 1 FROM visible_sources s WHERE s.ad_account_ref IS NOT NULL AND s.active_dates @> d.day
              AND NOT EXISTS (
                SELECT 1 FROM ops_reports r WHERE r.ad_account_ref=s.ad_account_ref AND r.business_date=d.day
                  AND NOT EXISTS (SELECT 1 FROM supervisor_consultation_sources h WHERE h.report_id=r.id)
              )
          ) THEN 'incomplete'
          WHEN t.consultations=0 THEN 'zero_consultations' ELSE 'ready' END AS status
        FROM dates d LEFT JOIN totals t ON t.business_date=d.day
        ORDER BY d.day`, [actor.id, from, to]);
      res.set("Cache-Control", "private, no-store").json({ days });
    } catch (error) { next(error); }
  });
  return router;
}
