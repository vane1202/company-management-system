import { Router } from "express";
import type { Pool } from "pg";
import { query, queryOne } from "../db.js";
import { addDays, businessToday, isIsoDate, resolvePeriod } from "../lib/dates.js";
import {
  EDITOR_FIELD_NOTE,
  FAN_STATS_INCOMPLETE_NOTE,
  OPS_CURRENCY_NOTE,
  lastMonthCumulative,
  lastMoneySnapshotsThenSum,
  lastSnapshotsThenSum,
  summarizeFanRows,
  type FanMetricRow
} from "../lib/dailyMetrics.js";
import { addMoney, formatMoney, subMoney } from "../lib/money.js";
import { allocateSalaries } from "../lib/salary.js";
import { HttpError } from "../types.js";
import { isBossOrAdmin } from "../users.js";
import type { AppConfig } from "../config.js";

export function createDashboardRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/summary", async (req, res, next) => {
    try {
      if (!req.actor || !isBossOrAdmin(req.actor)) {
        throw new HttpError(403, "只有 Boss 或行政可以查看全局经营汇总");
      }
      if (req.query.reviewStatus) throw new HttpError(400, "审核筛选已停用");
      const today = businessToday(new Date(), config.businessTimezone);
      let period: { from: string; to: string };
      try { period = resolvePeriod(
        req.query.preset ? String(req.query.preset) : undefined,
        req.query.from ? String(req.query.from) : undefined,
        req.query.to ? String(req.query.to) : undefined,
        today
      ); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "日期范围无效"); }

      const orderAgg = await queryOne<{
        order_count: string;
        revenue: string;
        refunds: string;
        custom_cost: string;
        labor_cost: string;
        shipping_cost: string;
      }>(
        db,
        `SELECT COUNT(*) FILTER (WHERE status <> 'refunded')::text AS order_count,
                COALESCE(SUM(amount), 0)::text AS revenue,
                COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::text AS refunds,
                COALESCE(SUM(custom_product_cost), 0)::text AS custom_cost,
                COALESCE(SUM(labor_cost), 0)::text AS labor_cost,
                COALESCE(SUM(shipping_cost), 0)::text AS shipping_cost
           FROM orders
          WHERE business_date BETWEEN $1 AND $2`,
        [period.from, period.to]
      );

      const promo = await queryOne<{ promo_cost: string; promo_videos: string }>(
        db,
        `SELECT COALESCE(SUM(promo_cost), 0)::text AS promo_cost,
                COALESCE(SUM(promo_video_count), 0)::text AS promo_videos
           FROM ops_reports
          WHERE business_date BETWEEN $1 AND $2`,
        [period.from, period.to]
      );

      const editor = await queryOne<{ shoot: string; finished: string; published: string }>(
        db,
        `SELECT COALESCE(SUM(shoot_count),0)::text AS shoot,
                COALESCE(SUM(finished_count),0)::text AS finished,
                COALESCE(SUM(published_count),0)::text AS published
           FROM editor_reports
          WHERE business_date BETWEEN $1 AND $2`,
        [period.from, period.to]
      );

      const latestInventory = await query<{
        user_id: string;
        persona_name: string;
        inventory_snapshot: number;
        business_date: string;
      }>(
        db,
        `SELECT DISTINCT ON (user_id, persona_name)
                user_id, persona_name, inventory_snapshot, business_date::text
           FROM editor_reports
          WHERE business_date BETWEEN $1 AND $2
          ORDER BY user_id, persona_name, business_date DESC`,
        [period.from, period.to]
      );

      const editorExtra = await queryOne<{ edit_count: string; sent_to_ops: string }>(
        db,
        `SELECT COALESCE(SUM(edit_count),0)::text AS edit_count,
                COALESCE(SUM(sent_to_ops_count),0)::text AS sent_to_ops
           FROM editor_reports
          WHERE business_date BETWEEN $1 AND $2`,
        [period.from, period.to]
      );

      const fanRows = await query<FanMetricRow>(
        db,
        `SELECT user_id, business_date::text, page_name, added_count, ms_today, ws_today,
                ms_month, ws_month, valid_today, comm_replied, comm_read_no_reply, comm_unread, comm_invalid
           FROM fan_reports
          WHERE business_date BETWEEN $1 AND $2`,
        [period.from, period.to]
      );
      const fanSummary = summarizeFanRows(fanRows);
      const fanMonthRows = await loadFanMonthRows(db, period.to);

      const salaryRows = await query<{ monthly_amount: string; effective_from: string; effective_to: string | null }>(
        db,
        `SELECT monthly_amount::text, effective_from::text, effective_to::text
           FROM salaries
          WHERE effective_from <= $2
            AND (effective_to IS NULL OR effective_to >= $1)`,
        [period.from, period.to]
      );

      const salaryAllocated = allocateSalaries(salaryRows, period.from, period.to);
      const revenue = formatMoney(orderAgg?.revenue ?? "0");
      const refunds = formatMoney(orderAgg?.refunds ?? "0");
      const promoCost = formatMoney(promo?.promo_cost ?? "0");
      const customCost = formatMoney(orderAgg?.custom_cost ?? "0");
      const laborCost = formatMoney(orderAgg?.labor_cost ?? "0");
      const shippingCost = formatMoney(orderAgg?.shipping_cost ?? "0");
      const laborAndShipping = addMoney([laborCost, shippingCost]);
      const estimate = subMoney(
        subMoney(subMoney(subMoney(subMoney(revenue, refunds), promoCost), salaryAllocated), customCost),
        laborAndShipping
      );
      const opsUsd = await loadOpsUsdBundle(db, period.from, period.to);
      const dataCounts = await queryOne<{ fans: number; ops: number; editor: number }>(db,
        `SELECT (SELECT count(*)::int FROM fan_reports WHERE business_date BETWEEN $1 AND $2) AS fans,
                (SELECT count(*)::int FROM ops_reports WHERE business_date BETWEEN $1 AND $2) AS ops,
                (SELECT count(*)::int FROM editor_reports WHERE business_date BETWEEN $1 AND $2) AS editor`,
        [period.from, period.to]);
      res.json({
        period,
        dataCounts,
        reviewRequired: false,
        overallSalary: {
          allocated: salaryAllocated,
          note: "工资按查询区间分摊，不与美元投放花费相加。经营估算只扣工资标准的底薪分摊；财务手工录入的提成、奖金、扣款不计入本估算（避免与底薪重复或按天拆分月度项目），完整应发/实发请看工资汇总页。",
          payrollItemsIncluded: false
        },
        opsUsd,
        metrics: {
          revenue,
          refunds,
          promoCost,
          salaryAllocated,
          customProductCost: customCost,
          laborCost,
          shippingCost,
          estimate,
          orderCount: Number(orderAgg?.order_count ?? 0),
          promoVideoCount: Number(promo?.promo_videos ?? 0),
          shootCount: Number(editor?.shoot ?? 0),
          finishedCount: Number(editor?.finished ?? 0),
          publishedCount: Number(editor?.published ?? 0),
          endingInventory: lastSnapshotsThenSum(
            latestInventory.map((row) => ({
              user_id: row.user_id,
              persona_name: row.persona_name,
              business_date: row.business_date,
              value: row.inventory_snapshot
            }))
          ),
          fanAddedTotal: fanSummary.todayTotal,
          editCount: Number(editorExtra?.edit_count ?? 0),
          sentToOpsCount: Number(editorExtra?.sent_to_ops ?? 0),
          msToday: fanSummary.msToday,
          wsToday: fanSummary.wsToday,
          msMonth: lastMonthCumulative(fanMonthRows, "ms_month"),
          wsMonth: lastMonthCumulative(fanMonthRows, "ws_month"),
          validToday: fanSummary.validToday,
          commReplied: fanSummary.commReplied,
          commReadNoReply: fanSummary.commReadNoReply,
          commUnread: fanSummary.commUnread,
          commInvalid: fanSummary.commInvalid,
          legacyUnclassifiedAdded: fanSummary.legacyUnclassifiedAdded,
          statsIncomplete: fanSummary.statsIncomplete
        },
        currencyNotes: {
          promoCost: "unknown_legacy",
          spendUsd: "USD",
          salary: "CNY_assumed_existing",
          note: OPS_CURRENCY_NOTE
        },
        fieldNotes: {
          fans: FAN_STATS_INCOMPLETE_NOTE,
          ops: OPS_CURRENCY_NOTE,
          editor: EDITOR_FIELD_NOTE
        },
        formula: "收入 - 退款 - 推广费 - 工资分摊 - 定制商品成本 - 工费 - 运费",
        estimateScope: "all_daily_minus_overall_salary",
        estimateNote: "填报数据直接计入统计。估算中的推广费只含历史 promo_cost（币种未知/legacy），不含新的美元花费，也不会把美元与人民币工资相加或换汇。",
        disclaimer: "此结果为经营估算，用于看日常趋势，不等于会计净利润；未包含房租、水电、税费、社保公积金、平台扣点等。收入为查询期内全部订单金额（含状态为退款的源订单），退款为状态=退款的订单金额之和；估算按收入减去退款，避免同一笔退款订单先从收入排除再扣一次。退款订单的成本仍计入。订单按录入的业务日归属，没有独立退款日或部分退款字段。"
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * 按业务日（Asia/Shanghai）的加粉日序列，供 7 天趋势线使用。权限与 /summary 相同。
   * 只返回可按天相加的流量值（当日新增、当日有效）；余额、库存、月累计等快照不在这里求和。
   * 某天没有任何加粉填报时 fanAdded 为 null（不是 0），前端据此断开线条。
   */
  router.get("/series", async (req, res, next) => {
    try {
      if (!req.actor || !isBossOrAdmin(req.actor)) {
        throw new HttpError(403, "只有 Boss 或行政可以查看全局经营汇总");
      }
      const today = businessToday(new Date(), config.businessTimezone);
      const to = req.query.to ? String(req.query.to) : today;
      if (!isIsoDate(to)) throw new HttpError(400, "日期格式无效");
      const days = req.query.days ? Number(req.query.days) : 7;
      if (!Number.isInteger(days) || days < 1 || days > 31) throw new HttpError(400, "天数须为 1–31 的整数");
      const from = addDays(to, -(days - 1));
      const rows = await query<FanMetricRow>(
        db,
        `SELECT user_id, business_date::text, page_name, added_count, ms_today, ws_today,
                ms_month, ws_month, valid_today, comm_replied, comm_read_no_reply, comm_unread, comm_invalid
           FROM fan_reports
          WHERE business_date BETWEEN $1 AND $2`,
        [from, to]
      );
      const byDate = new Map<string, FanMetricRow[]>();
      for (const row of rows) {
        const date = String(row.business_date).slice(0, 10);
        const list = byDate.get(date) ?? [];
        list.push(row);
        byDate.set(date, list);
      }
      const series = Array.from({ length: days }, (_, index) => {
        const date = addDays(from, index);
        const dayRows = byDate.get(date) ?? [];
        const summary = summarizeFanRows(dayRows);
        return {
          date,
          reports: dayRows.length,
          fanAdded: dayRows.length ? summary.todayTotal : null,
          validToday: dayRows.length ? summary.validToday : null,
          partial: date === today
        };
      });
      res.json({ from, to, today, days: series });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function loadOpsUsdBundle(
  db: Pool,
  from: string,
  to: string
) {
  const filter = "business_date BETWEEN $1 AND $2";
  const params = [from, to];
  const totals = await queryOne<{ spend: string; consults: string; clicks: string }>(
    db,
    `SELECT COALESCE(SUM(spend_usd),0)::text AS spend,
            COALESCE(SUM(consult_count),0)::text AS consults,
            COALESCE(SUM(click_count),0)::text AS clicks
       FROM ops_reports
      WHERE ${filter}`,
    params
  );
  const balances = await query<{
    user_id: string;
    persona_name: string;
    business_date: string;
    balance_usd: string | null;
  }>(
    db,
    `SELECT DISTINCT ON (user_id, persona_name)
            user_id, persona_name, business_date::text, balance_usd::text
       FROM ops_reports
      WHERE ${filter} AND balance_usd IS NOT NULL
      ORDER BY user_id, persona_name, business_date DESC`,
    params
  );
  return {
    currency: "USD",
    spendUsd: formatMoney(totals?.spend ?? "0"),
    consultCount: Number(totals?.consults ?? 0),
    clickCount: Number(totals?.clicks ?? 0),
    endingBalanceUsd:
      lastMoneySnapshotsThenSum(
        balances.map((row) => ({
          user_id: row.user_id,
          persona_name: row.persona_name,
          business_date: row.business_date,
          value: row.balance_usd
        }))
      ),
    consultCostNote: "每次咨询成本是独立上报值，不按花费÷咨询数回算，也不汇总成单一成本。",
    ctrNote: "没有曝光量，系统不会回算或汇总点击率。",
    note: OPS_CURRENCY_NOTE
  };
}

async function loadFanMonthRows(db: Pool, to: string): Promise<FanMetricRow[]> {
  return query<FanMetricRow>(db,
    `SELECT user_id, business_date::text, page_name, ms_today, ws_today, ms_month, ws_month
       FROM fan_reports WHERE business_date BETWEEN $1 AND $2
`,
    [`${to.slice(0, 7)}-01`, to]);
}
