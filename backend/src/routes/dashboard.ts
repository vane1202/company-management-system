import { Router } from "express";
import type { Pool } from "pg";
import { query, queryOne } from "../db.js";
import { businessToday, resolvePeriod } from "../lib/dates.js";
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
      const today = businessToday(new Date(), config.businessTimezone);
      const period = resolvePeriod(
        req.query.preset ? String(req.query.preset) : undefined,
        req.query.from ? String(req.query.from) : undefined,
        req.query.to ? String(req.query.to) : undefined,
        today
      );

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

      const latestInventory = await query<{ inventory_snapshot: number }>(
        db,
        `SELECT DISTINCT ON (user_id) inventory_snapshot
           FROM editor_reports
          WHERE business_date BETWEEN $1 AND $2
          ORDER BY user_id, business_date DESC`,
        [period.from, period.to]
      );

      const fans = await queryOne<{ total: string }>(
        db,
        `SELECT COALESCE(SUM(added_count),0)::text AS total
           FROM fan_reports
          WHERE business_date BETWEEN $1 AND $2`,
        [period.from, period.to]
      );

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

      res.json({
        period,
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
          endingInventory: latestInventory.reduce((sum, row) => sum + Number(row.inventory_snapshot), 0),
          fanAddedTotal: Number(fans?.total ?? 0)
        },
        formula: "收入 - 退款 - 推广费 - 工资分摊 - 定制商品成本 - 工费 - 运费",
        disclaimer: "此结果为经营估算，用于看日常趋势，不等于会计净利润；未包含房租、水电、税费、社保公积金、平台扣点等。收入为查询期内全部订单金额（含状态为退款的源订单），退款为状态=退款的订单金额之和；估算按收入减去退款，避免同一笔退款订单先从收入排除再扣一次。退款订单的成本仍计入。订单按录入的业务日归属，没有独立退款日或部分退款字段。"
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

