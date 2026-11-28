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
        base_revenue: string;
        base_refunds: string;
        additional_revenue: string;
        additional_refunds: string;
        custom_cost: string;
        labor_cost: string;
        shipping_cost: string;
      }>(
        db,
        `WITH scoped_orders AS (
           SELECT o.id,
                  o.business_date,
                  o.status,
                  o.amount,
                  o.custom_product_cost,
                  o.labor_cost,
                  o.shipping_cost,
                  EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL) AS cancelled,
                  EXISTS(SELECT 1 FROM order_details d WHERE d.order_id = o.id) AS has_details,
                  COALESCE((SELECT SUM(i.price_cny + i.buying_fee_cny) FROM order_items i WHERE i.order_id = o.id), o.amount) AS modern_booking_amount
             FROM orders o
         ),
         charge_agg AS (
           SELECT COALESCE(SUM(a.amount_cny) FILTER (WHERE NOT o.cancelled), 0) AS additional_revenue,
                  COALESCE(SUM(a.amount_cny) FILTER (WHERE o.status = 'refunded' AND NOT o.cancelled), 0) AS additional_refunds
             FROM order_charges a
             JOIN scoped_orders o ON o.id = a.order_id
            WHERE a.voided_at IS NULL
              AND a.business_date BETWEEN $1 AND $2
         ),
         expense_agg AS (
           SELECT COALESCE(SUM(e.amount_cny) FILTER (WHERE e.category IN ('goods','sourcing','accessory','certificate','box','other')), 0) AS custom_cost,
                  COALESCE(SUM(e.amount_cny) FILTER (WHERE e.category IN ('labor','design')), 0) AS labor_cost,
                  COALESCE(SUM(e.amount_cny) FILTER (WHERE e.category = 'shipping'), 0) AS shipping_cost
             FROM order_expenses e
            WHERE e.voided_at IS NULL
              AND e.business_date BETWEEN $1 AND $2
         )
         SELECT COUNT(*) FILTER (WHERE o.business_date BETWEEN $1 AND $2 AND o.status <> 'refunded' AND NOT o.cancelled)::text AS order_count,
                COALESCE(SUM(CASE WHEN o.has_details THEN o.modern_booking_amount ELSE o.amount END) FILTER (WHERE o.business_date BETWEEN $1 AND $2 AND NOT o.cancelled), 0)::text AS base_revenue,
                COALESCE(SUM(CASE WHEN o.has_details THEN o.modern_booking_amount ELSE o.amount END) FILTER (WHERE o.business_date BETWEEN $1 AND $2 AND o.status = 'refunded' AND NOT o.cancelled), 0)::text AS base_refunds,
                (SELECT additional_revenue FROM charge_agg)::text AS additional_revenue,
                (SELECT additional_refunds FROM charge_agg)::text AS additional_refunds,
                (COALESCE(SUM(o.custom_product_cost) FILTER (WHERE o.business_date BETWEEN $1 AND $2 AND NOT o.has_details), 0) + (SELECT custom_cost FROM expense_agg))::text AS custom_cost,
                (COALESCE(SUM(o.labor_cost) FILTER (WHERE o.business_date BETWEEN $1 AND $2 AND NOT o.has_details), 0) + (SELECT labor_cost FROM expense_agg))::text AS labor_cost,
                (COALESCE(SUM(o.shipping_cost) FILTER (WHERE o.business_date BETWEEN $1 AND $2 AND NOT o.has_details), 0) + (SELECT shipping_cost FROM expense_agg))::text AS shipping_cost
           FROM scoped_orders o`,
        [period.from, period.to]
      );

      const receiptRows = await query<{ currency: "CNY" | "TWD" | "USD" | "SGD" | "HKD"; total: string }>(
        db,
        `SELECT currency, COALESCE(SUM(amount), 0)::text AS total
           FROM customer_payments
          WHERE voided_at IS NULL
            AND payment_date BETWEEN $1 AND $2
          GROUP BY currency`,
        [period.from, period.to]
      );
      const customerReceipts = { CNY: "0.00", TWD: "0.00", USD: "0.00", SGD: "0.00", HKD: "0.00" };
      for (const row of receiptRows) {
        if (row.currency in customerReceipts) {
          customerReceipts[row.currency] = formatMoney(row.total);
        }
      }

      const cashTotals = await queryOne<{ company_received_cny: string; supplier_paid_cny: string }>(
        db,
        `SELECT (
                  COALESCE((SELECT SUM(COALESCE(p.verified_cny, p.amount)) FROM customer_payments p WHERE p.voided_at IS NULL AND p.verify_status = 'confirmed' AND NOT p.third_party AND p.currency = 'CNY' AND COALESCE(p.verified_on, p.payment_date) BETWEEN $1 AND $2), 0) +
                  COALESCE((SELECT SUM(a.net_cny) FROM settlement_allocations a JOIN finance_settlements s ON s.id = a.settlement_id JOIN customer_payments p ON p.id = a.payment_id WHERE s.voided_at IS NULL AND p.voided_at IS NULL AND s.settled_on BETWEEN $1 AND $2), 0)
                )::text AS company_received_cny,
                COALESCE((SELECT SUM(p.amount_cny) FROM supplier_payments p JOIN order_expenses e ON e.id = p.expense_id WHERE p.voided_at IS NULL AND e.voided_at IS NULL AND p.paid_on BETWEEN $1 AND $2), 0)::text AS supplier_paid_cny`,
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
        `SELECT DISTINCT ON (COALESCE(editor_name,user_id::text), persona_name)
                COALESCE(editor_name,user_id::text) AS user_id, persona_name, inventory_snapshot, business_date::text
           FROM editor_reports
          WHERE business_date BETWEEN $1 AND $2
          ORDER BY COALESCE(editor_name,user_id::text), persona_name, business_date DESC`,
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
      const baseOrderRevenue = formatMoney(orderAgg?.base_revenue ?? "0");
      const additionalChargesRevenue = formatMoney(orderAgg?.additional_revenue ?? "0");
      const revenue = addMoney([baseOrderRevenue, additionalChargesRevenue]);
      const refunds = addMoney([
        formatMoney(orderAgg?.base_refunds ?? "0"),
        formatMoney(orderAgg?.additional_refunds ?? "0")
      ]);
      const promoCost = formatMoney(promo?.promo_cost ?? "0");
      const customCost = formatMoney(orderAgg?.custom_cost ?? "0");
      const laborCost = formatMoney(orderAgg?.labor_cost ?? "0");
      const shippingCost = formatMoney(orderAgg?.shipping_cost ?? "0");
      const laborAndShipping = addMoney([laborCost, shippingCost]);
      const estimate = subMoney(
        subMoney(subMoney(subMoney(subMoney(revenue, refunds), promoCost), salaryAllocated), customCost),
        laborAndShipping
      );
      const companyReceivedCny = formatMoney(cashTotals?.company_received_cny ?? "0");
      const supplierPaidCny = formatMoney(cashTotals?.supplier_paid_cny ?? "0");
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
          baseOrderRevenue,
          additionalChargesRevenue,
          refunds,
          promoCost,
          salaryAllocated,
          customProductCost: customCost,
          laborCost,
          shippingCost,
          estimate,
          customerReceipts,
          companyReceivedCny,
          supplierPaidCny,
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
        estimateNote: "填报数据直接计入统计。现代订单档案按事件发生日分别归集：开单金额按开单业务日、追加收费按收费业务日、商品/工费/运费支出按费用发生日、收款与付款按各自收付款日；跑单回冲原开单日。估算中的推广费只含历史 promo_cost（币种未知/legacy），不含新的美元花费，也不会把美元与人民币工资相加或换汇。",
        disclaimer: "此结果为经营估算，用于看日常趋势，不等于会计净利润；未包含房租、水电、税费、社保公积金、平台扣点等。收入为查询期内排除跑单后的开单金额与当日追加收费之和（仍含状态为退款的源订单），退款为状态=退款的订单金额之和；估算按收入减去退款，避免同一笔退款订单先从收入排除再扣一次。退款及跑单订单已经发生的成本仍计入。跑单回冲原开单日，不生成退款流水；旧版简单订单（未建完整档案）仍按订单录入业务日归属。"
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
  const ledger=await queryOne<{count:number;balance:string}>(db,`SELECT count(*)::int AS count,COALESCE(sum(a.opening_usd+COALESCE((SELECT sum(t.credited_usd) FROM ad_topups t WHERE t.account_ref=a.code AND t.voided_at IS NULL AND t.paid_on<=$1),0)-COALESCE((SELECT sum(r.spend_usd) FROM ops_reports r WHERE r.ad_account_ref=a.code AND r.business_date BETWEEN a.opened_on AND $1),0)),0)::text AS balance FROM ad_accounts a WHERE a.opened_on<=$1`,[to]);
  return {
    balanceMethod:ledger?.count?"account_ledger":"legacy_persona_snapshot",
    currency: "USD",
    spendUsd: formatMoney(totals?.spend ?? "0"),
    consultCount: Number(totals?.consults ?? 0),
    clickCount: Number(totals?.clicks ?? 0),
    endingBalanceUsd:ledger?.count?formatMoney(ledger.balance):
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
