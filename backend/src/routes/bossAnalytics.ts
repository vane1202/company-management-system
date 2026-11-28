import { Router } from "express";
import { liveRoomSql } from "../lib/liveRoomIdentity.js";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { addDays, businessToday, isIsoDate, resolvePeriod } from "../lib/dates.js";
import { centsToMoney, moneyToCents } from "../lib/money.js";

const EXPENSE_CATEGORIES = [
  { key: "rent", label: "房租" },
  { key: "utilities", label: "水电" },
  { key: "salary", label: "员工工资" },
  { key: "hospitality", label: "接待费用" },
  { key: "other", label: "其他费用" }
] as const;

const OPS_DIMENSIONS = {
  persona: "personaName",
  platform: "platform",
  account: "adAccountRef",
  operator: "operatorName"
} as const;

type OpsDimension = keyof typeof OPS_DIMENSIONS;

function queryText(value: unknown, maxLen = 128): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maxLen) throw new HttpError(400, "筛选参数无效");
  return value.trim();
}

function daysBetween(from: string, to: string): string[] {
  const result: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

function previousPeriod(preset: string, from: string, to: string): { from: string; to: string; label: string } {
  if (preset === "day" && from === to) {
    const prev = addDays(from, -1);
    return { from: prev, to: prev, label: "昨日已报" };
  }
  if (preset === "week") {
    return { from: addDays(from, -7), to: addDays(to, -7), label: "上周同期已报" };
  }
  if (preset === "month") {
    const [y, m, d] = from.split("-").map(Number);
    const prevYear = m === 1 ? y - 1 : y;
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevFrom = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const span = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
    return { from: prevFrom, to: addDays(prevFrom, span), label: "上月同期已报" };
  }
  const span = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
  return { from: addDays(from, -span), to: addDays(to, -span), label: "上期已报" };
}

type OpsRecord = {
  id: string;
  userId: string;
  operatorName: string;
  businessDate: string;
  platform: string;
  personaName: string;
  adAccountRef: string;
  promoVideoCount: number | null;
  promoCost: string;
  spendUsd: string | null;
  consultCount: number | null;
  consultCostUsd: string | null;
  clickCount: number | null;
  ctrPercent: string | null;
  balanceUsd: string | null;
  note: string;
  updatedAt: string;
};

function sumMoneyOrNull(rows: OpsRecord[], key: "spendUsd"): string | null {
  if (!rows.length || !rows.every((r) => r[key] != null)) return null;
  return centsToMoney(rows.reduce((sum, r) => sum + moneyToCents(r[key]!), 0n));
}

function sumIntOrNull(rows: OpsRecord[], key: "consultCount" | "clickCount"): number | null {
  if (!rows.length || !rows.every((r) => typeof r[key] === "number" && Number.isSafeInteger(r[key]) && r[key]! >= 0)) return null;
  return rows.reduce((sum, r) => sum + r[key]!, 0);
}

function computeOpsTotals(rows: OpsRecord[]) {
  const spendUsd = sumMoneyOrNull(rows, "spendUsd");
  const consultCount = sumIntOrNull(rows, "consultCount");
  const clickCount = sumIntOrNull(rows, "clickCount");
  const costStatus = !rows.length
    ? "empty"
    : spendUsd == null || consultCount == null
      ? "incomplete"
      : consultCount === 0
        ? (spendUsd === "0.00" ? "no_spend" : "no_consultation")
        : "ready";
  const consultationCostUsd = costStatus === "ready"
    ? centsToMoney((moneyToCents(spendUsd!) + BigInt(consultCount!) / 2n) / BigInt(consultCount!))
    : null;
  return {
    spendUsd,
    spendCny: null as string | null,
    consultCount,
    clickCount,
    consultationCostUsd,
    costStatus,
    recordCount: rows.length,
    missingSpendCount: rows.filter((r) => r.spendUsd == null).length,
    missingConsultCount: rows.filter((r) => !(typeof r.consultCount === "number" && Number.isSafeInteger(r.consultCount) && r.consultCount >= 0)).length,
    missingClickCount: rows.filter((r) => !(typeof r.clickCount === "number" && Number.isSafeInteger(r.clickCount) && r.clickCount >= 0)).length,
    reportedDays: new Set(rows.map((r) => r.businessDate)).size
  };
}

function computeOpsBalances(allRows: OpsRecord[], selectedRows: OpsRecord[], to: string) {
  const accounts = [...new Set(selectedRows.map((r) => r.adAccountRef).filter(Boolean))].sort();
  return accounts.map((account) => {
    const candidates = allRows
      .filter((r) => r.adAccountRef === account && r.businessDate <= to && r.balanceUsd != null)
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.updatedAt.localeCompare(a.updatedAt));
    const last = candidates[0];
    const shared = new Set(allRows.filter((r) => r.adAccountRef === account).map((r) => r.personaName)).size > 1;
    if (!last) return { account, amountUsd: null as string | null, date: null as string | null, status: "missing" as const, shared };
    const sameTime = candidates.filter((r) => r.businessDate === last.businessDate && r.updatedAt === last.updatedAt);
    const conflict = new Set(sameTime.map((r) => r.balanceUsd)).size > 1;
    return {
      account,
      amountUsd: conflict ? null : last.balanceUsd,
      date: last.businessDate,
      status: conflict ? ("conflict" as const) : ("ready" as const),
      shared
    };
  });
}

const MATERIAL_EXPENSE_CATEGORIES = new Set(["goods", "sourcing", "material"]);
const DEFAULT_FX_TO_CNY: Record<string, number> = {
  CNY: 1,
  USD: 7.24,
  TWD: 0.2235,
  SGD: 5.38,
  HKD: 0.93
};

function convertToCnyCents(amountText: string, currency: string, fxRateText: string | null): bigint {
  const rawCents = moneyToCents(amountText);
  if (currency === "CNY") return rawCents;
  const rate = fxRateText ? Number(fxRateText) : (DEFAULT_FX_TO_CNY[currency] ?? 1);
  if (!Number.isFinite(rate) || rate <= 0) return rawCents;
  return BigInt(Math.round(Number(rawCents) * rate));
}

function allocateByWeight(totalCents: bigint, weights: bigint[]): bigint[] {
  if (!weights.length) return [];
  const totalWeight = weights.reduce((sum, w) => sum + (w > 0n ? w : 0n), 0n);
  if (totalCents === 0n || totalWeight <= 0n) return weights.map(() => 0n);
  const result = weights.map((w) => (w > 0n ? (totalCents * w) / totalWeight : 0n));
  const allocated = result.reduce((sum, v) => sum + v, 0n);
  const remainder = totalCents - allocated;
  if (remainder !== 0n) {
    let maxIdx = 0;
    for (let i = 1; i < weights.length; i++) {
      if (weights[i] > weights[maxIdx]) maxIdx = i;
    }
    result[maxIdx] += remainder;
  }
  return result;
}

function ratioPercent(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 1000n) / denominator) / 10;
}

export function createBossAnalyticsRouter(db: Pool, config: AppConfig): Router {
  const router = Router();

  router.get("/boss-priority", async (req, res, next) => {
    if (req.actor?.role !== "boss") {
      next(new HttpError(403, "仅 BOSS 可查看经营总览"));
      return;
    }
    let client: PoolClient | undefined;
    try {
      const today = businessToday(new Date(), config.businessTimezone);
      let period: { from: string; to: string };
      try {
        period = resolvePeriod(
          queryText(req.query.preset) || undefined,
          queryText(req.query.from) || undefined,
          queryText(req.query.to) || undefined,
          today
        );
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : "日期范围无效");
      }
      const trendFrom = period.from === period.to ? addDays(period.to, -6) : period.from;
      const inPeriod = (date: string) => date >= period.from && date <= period.to;

      client = await db.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

      const allOrders = (
        await client.query<{
          id: string;
          business_date: string;
          status: string;
          cancelled: boolean;
          booking_amount: string;
          material_cost_cny: string | null;
          deal_channel: string;
          room_code: string;
          operator_name: string;
          user_id: string;
          team_name: string | null;
        }>(
          `SELECT o.id::text AS id,
                  o.business_date::text AS business_date,
                  o.status,
                  EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL) AS cancelled,
                  CASE WHEN d.order_id IS NULL THEN o.amount
                       ELSE COALESCE((SELECT SUM(i.price_cny + i.buying_fee_cny) FROM order_items i WHERE i.order_id = o.id), o.amount)
                  END::numeric(14,2)::text AS booking_amount,
                  o.material_cost_cny::text AS material_cost_cny,
                  COALESCE(NULLIF(trim(d.deal_channel), ''), 'live') AS deal_channel,
                  COALESCE(NULLIF(trim(${liveRoomSql("d.live_room_code")}), ''), 'unassigned') AS room_code,
                  COALESCE(NULLIF(trim(d.operator_name), ''), u.display_name, '') AS operator_name,
                  o.user_id::text AS user_id,
                  t.name AS team_name
             FROM orders o
             LEFT JOIN order_details d ON d.order_id = o.id
             LEFT JOIN users u ON u.id = o.user_id
             LEFT JOIN LATERAL (
               SELECT m.team_id
                 FROM team_memberships m
                WHERE m.user_id = o.user_id
                  AND m.start_date <= o.business_date
                  AND (m.end_date IS NULL OR m.end_date >= o.business_date)
                ORDER BY m.start_date DESC
                LIMIT 1
             ) mem ON TRUE
             LEFT JOIN teams t ON t.id = mem.team_id
            WHERE o.business_date BETWEEN $1 AND $2`,
          [trendFrom, period.to]
        )
      ).rows;

      const fanRows = (
        await client.query<{
          user_id: string;
          display_name: string;
          team_name: string | null;
          added_count: number;
          valid_today: number | null;
          comm_invalid: number | null;
        }>(
          `SELECT f.user_id::text AS user_id,
                  COALESCE(u.display_name, '') AS display_name,
                  t.name AS team_name,
                  f.added_count,
                  f.valid_today,
                  f.comm_invalid
             FROM fan_reports f
             LEFT JOIN users u ON u.id = f.user_id
             LEFT JOIN teams t ON t.id = f.team_id
            WHERE f.business_date BETWEEN $1 AND $2`,
          [period.from, period.to]
        )
      ).rows;

      const expenseRows = (
        await client.query<{
          id: string;
          category: string;
          date: string;
          amount: string;
          purpose: string;
          operator: string;
          proof: string;
        }>(
          `SELECT id::text AS id, category, business_date::text AS date, amount_cny::text AS amount, purpose, operator_name AS operator, proof
             FROM daily_operating_expenses
            WHERE voided_at IS NULL AND business_date BETWEEN $1 AND $2
            ORDER BY business_date, created_at`,
          [trendFrom, period.to]
        )
      ).rows;

      const approvedReimbursementRows = (
        await client.query<{
          id: string;
          date: string;
          amount: string;
          claim_type: string;
        }>(
          `SELECT id::text AS id, expense_date::text AS date, amount_cny::text AS amount, claim_type
             FROM reimbursement_claims
            WHERE status = 'approved'
              AND posted_expense_id IS NULL
              AND expense_date BETWEEN $1 AND $2`,
          [trendFrom, period.to]
        )
      ).rows;

      const orderIdsInWindow = allOrders.map((o) => o.id);
      const orderExpenseRows = (
        await client.query<{
          order_id: string;
          business_date: string;
          category: string;
          amount_cny: string;
          order_cancelled: boolean;
          order_status: string;
          deal_channel: string;
          room_code: string;
        }>(
          `SELECT e.order_id::text AS order_id,
                  e.business_date::text AS business_date,
                  e.category,
                  e.amount_cny::text AS amount_cny,
                  EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL) AS order_cancelled,
                  o.status AS order_status,
                  COALESCE(NULLIF(trim(d.deal_channel), ''), 'live') AS deal_channel,
                  COALESCE(NULLIF(trim(${liveRoomSql("d.live_room_code")}), ''), 'unassigned') AS room_code
             FROM order_expenses e
             JOIN orders o ON o.id = e.order_id
             LEFT JOIN order_details d ON d.order_id = o.id
            WHERE e.voided_at IS NULL
              AND (e.business_date BETWEEN $1 AND $2 OR e.order_id = ANY($3::uuid[]))`,
          [trendFrom, period.to, orderIdsInWindow]
        )
      ).rows;

      const chargeRows = (
        await client.query<{
          business_date: string;
          amount_cny: string;
        }>(
          `SELECT c.business_date::text AS business_date, c.amount_cny::text AS amount_cny
             FROM order_charges c
             JOIN orders o ON o.id = c.order_id
            WHERE c.voided_at IS NULL
              AND o.status <> 'refunded'
              AND NOT EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL)
              AND c.business_date BETWEEN $1 AND $2`,
          [trendFrom, period.to]
        )
      ).rows;

      const settlementRows = (
        await client.query<{
          settled_on: string;
          fee_amount: string;
          fee_currency: string;
          fx_rate: string | null;
        }>(
          `SELECT settled_on::text AS settled_on,
                  fee_amount::text AS fee_amount,
                  fee_currency,
                  fx_rate::text AS fx_rate
             FROM finance_settlements
            WHERE voided_at IS NULL AND settled_on BETWEEN $1 AND $2`,
          [trendFrom, period.to]
        )
      ).rows;

      const opsAdRows = (
        await client.query<{
          business_date: string;
          spend_usd: string | null;
        }>(
          `SELECT business_date::text AS business_date, spend_usd::text AS spend_usd
             FROM ops_reports
            WHERE business_date BETWEEN $1 AND $2 AND spend_usd IS NOT NULL`,
          [trendFrom, period.to]
        )
      ).rows;

      const payMonth = period.to.slice(0, 7);
      const payrollRows = (
        await client.query<{
          status: string;
          locked_net: string | null;
        }>(
          `SELECT status, locked_net::text AS locked_net
             FROM payroll_months
            WHERE pay_month = $1`,
          [payMonth]
        )
      ).rows;

      const attentionCounts = (
        await client.query<{
          pending_verifications: string;
          pending_expenses: string;
          pending_warehouse: string;
        }>(
          `SELECT
             (SELECT count(*)::text FROM customer_payments WHERE voided_at IS NULL AND verify_status = 'pending') AS pending_verifications,
             (SELECT count(*)::text FROM reimbursement_claims WHERE workflow_stage = 'finance' AND status = 'pending') AS pending_expenses,
             (SELECT count(*)::text FROM warehouse_bills WHERE status = 'submitted') AS pending_warehouse`
        )
      ).rows[0];

      await client.query("COMMIT");

      const periodOrders = allOrders.filter((row) => inPeriod(row.business_date));
      const validWindowOrders = allOrders.filter((row) => !row.cancelled && row.status !== "refunded");
      const validOrders = validWindowOrders.filter((row) => inPeriod(row.business_date));

      const statsOf = (rows: typeof validOrders) => {
        let liveCents = 0n;
        let privateCents = 0n;
        for (const r of rows) {
          const amt = moneyToCents(r.booking_amount);
          if (r.deal_channel === "private") privateCents += amt;
          else liveCents += amt;
        }
        const totalCents = liveCents + privateCents;
        return {
          live: centsToMoney(liveCents),
          private: centsToMoney(privateCents),
          total: centsToMoney(totalCents),
          count: rows.length,
          privateShare: totalCents > 0n ? Number((privateCents * 10000n) / totalCents) / 100 : null
        };
      };

      // Map material expenses per order (from order_expenses) as fallback when material_cost_cny is null
      const orderMaterialExpenseMap = new Map<string, bigint>();
      for (const exp of orderExpenseRows) {
        if (!MATERIAL_EXPENSE_CATEGORIES.has(exp.category)) continue;
        orderMaterialExpenseMap.set(
          exp.order_id,
          (orderMaterialExpenseMap.get(exp.order_id) ?? 0n) + moneyToCents(exp.amount_cny)
        );
      }

      const materialCostForOrder = (order: (typeof validWindowOrders)[number]): { cents: bigint; missing: boolean } => {
        if (order.material_cost_cny != null) return { cents: moneyToCents(order.material_cost_cny), missing: false };
        const fallback = orderMaterialExpenseMap.get(order.id);
        if (fallback != null && fallback > 0n) return { cents: fallback, missing: false };
        return { cents: 0n, missing: true };
      };

      const validAfterSaleExpenses = orderExpenseRows.filter(
        (exp) => !MATERIAL_EXPENSE_CATEGORIES.has(exp.category) && !exp.order_cancelled && exp.order_status !== "refunded"
      );

      const periodPerf = statsOf(validOrders);
      const periodTurnoverCents = moneyToCents(periodPerf.total);
      const periodAvgOrderCents = validOrders.length > 0 ? periodTurnoverCents / BigInt(validOrders.length) : 0n;
      const periodAfterSalesCents = chargeRows
        .filter((c) => inPeriod(c.business_date))
        .reduce((sum, c) => sum + moneyToCents(c.amount_cny), 0n);

      let periodMaterialCostCents = 0n;
      let missingMaterialCostCount = 0;
      for (const o of validOrders) {
        const mc = materialCostForOrder(o);
        periodMaterialCostCents += mc.cents;
        if (mc.missing) missingMaterialCostCount += 1;
      }

      const periodAfterSaleCostCents = validAfterSaleExpenses
        .filter((e) => inPeriod(e.business_date))
        .reduce((sum, e) => sum + moneyToCents(e.amount_cny), 0n);

      const periodThirdPartyFeeCents = settlementRows
        .filter((s) => inPeriod(s.settled_on))
        .reduce((sum, s) => sum + convertToCnyCents(s.fee_amount, s.fee_currency, s.fx_rate), 0n);

      const periodAdSpendUsdCents = opsAdRows
        .filter((a) => inPeriod(a.business_date) && a.spend_usd != null)
        .reduce((sum, a) => sum + moneyToCents(a.spend_usd!), 0n);
      const periodAdSpendCnyCents = convertToCnyCents(centsToMoney(periodAdSpendUsdCents), "USD", null);

      const periodGrossProfitCents =
        periodTurnoverCents -
        periodMaterialCostCents -
        periodAfterSaleCostCents -
        periodThirdPartyFeeCents -
        periodAdSpendCnyCents;
      const periodGrossMargin = ratioPercent(periodGrossProfitCents, periodTurnoverCents);

      const periodDailyExpenses = expenseRows.filter((row) => inPeriod(row.date));
      const periodDailyTotalCents = periodDailyExpenses.reduce((sum, row) => sum + moneyToCents(row.amount), 0n);
      const periodReimRows = approvedReimbursementRows.filter((row) => inPeriod(row.date));
      const periodReimTotalCents = periodReimRows.reduce((sum, row) => sum + moneyToCents(row.amount), 0n);

      const hasLockedPayroll = payrollRows.length > 0 && payrollRows.every((p) => p.status === "locked");
      const payrollTotalCents = hasLockedPayroll
        ? payrollRows.reduce((sum, p) => sum + (p.locked_net ? moneyToCents(p.locked_net) : 0n), 0n)
        : 0n;
      const recordedSubtotalCents = periodDailyTotalCents + periodReimTotalCents + payrollTotalCents;

      const estimatedNetProfitCents = periodGrossProfitCents - recordedSubtotalCents;
      const netMargin = ratioPercent(estimatedNetProfitCents, periodTurnoverCents);

      const fansByName = new Map<string, { total: number; effective: number | null; invalid: number | null; pendingInvalid: number }>();
      let totalFansCount = 0;
      let effectiveFansCount = 0;
      let hasEffectiveFans = false;
      for (const f of fanRows) {
        totalFansCount += f.added_count || 0;
        if (f.valid_today != null) {
          effectiveFansCount += f.valid_today;
          hasEffectiveFans = true;
        }
        const key = f.display_name || f.user_id;
        const prev = fansByName.get(key) ?? { total: 0, effective: 0, invalid: 0, pendingInvalid: 0 };
        prev.total += f.added_count || 0;
        prev.effective = prev.effective !== null && f.valid_today != null ? prev.effective + f.valid_today : null;
        prev.invalid = prev.invalid !== null && !f.comm_invalid ? prev.invalid : null;
        prev.pendingInvalid += f.comm_invalid || 0;
        fansByName.set(key, prev);
      }
      const costPerEffectiveFanCny =
        hasEffectiveFans && effectiveFansCount > 0
          ? centsToMoney(periodAdSpendCnyCents / BigInt(effectiveFansCount))
          : null;

      const roomMap = new Map<string, typeof validOrders>();
      for (const row of validOrders) {
        const list = roomMap.get(row.room_code) ?? [];
        list.push(row);
        roomMap.set(row.room_code, list);
      }

      const rooms = [...roomMap.entries()]
        .sort(([a], [b]) => (a === "unassigned" ? 1 : b === "unassigned" ? -1 : a.localeCompare(b, "zh-CN")))
        .map(([roomId, rows]) => {
          const byMember = new Map<string, typeof validOrders>();
          for (const row of rows) {
            const key = row.operator_name || row.user_id || "未登记";
            const list = byMember.get(key) ?? [];
            list.push(row);
            byMember.set(key, list);
          }
          const members = [...byMember.entries()].map(([name, mRows]) => {
            const f = fansByName.get(name);
            return {
              id: `${roomId}:${name}`,
              name,
              team: mRows.find((r) => r.team_name)?.team_name ?? "",
              sample: false,
              ...statsOf(mRows),
              fans: f ? f.total : null,
              effective: f ? f.effective : null,
              invalid: f ? f.invalid : null,
              pendingInvalid: f ? f.pendingInvalid : 0
            };
          });
          return {
            id: roomId,
            name: roomId === "unassigned" ? "归属待核对" : roomId,
            team: rows.find((r) => r.team_name)?.team_name ?? null,
            status: roomId === "unassigned" ? "unassigned" : "ready",
            ...statsOf(rows),
            members
          };
        });

      // Channel profit breakdown: live rooms + private channel
      type ChannelBucket = { id: string; name: string; roomCode: string; isPrivate: boolean; count: number; turnoverCents: bigint; materialCostCents: bigint; afterSaleCostCents: bigint };
      const channelMap = new Map<string, ChannelBucket>();
      for (const o of validOrders) {
        const isPrivate = o.deal_channel === "private";
        const key = isPrivate ? "__private__" : o.room_code;
        const name = isPrivate ? "客服私推渠道" : o.room_code === "unassigned" ? "归属待核对" : o.room_code;
        const bucket = channelMap.get(key) ?? {
          id: key,
          name,
          roomCode: isPrivate ? "" : o.room_code,
          isPrivate,
          count: 0,
          turnoverCents: 0n,
          materialCostCents: 0n,
          afterSaleCostCents: 0n
        };
        bucket.count += 1;
        bucket.turnoverCents += moneyToCents(o.booking_amount);
        bucket.materialCostCents += materialCostForOrder(o).cents;
        channelMap.set(key, bucket);
      }
      for (const exp of validAfterSaleExpenses.filter((e) => inPeriod(e.business_date))) {
        const isPrivate = exp.deal_channel === "private";
        const key = isPrivate ? "__private__" : exp.room_code;
        const name = isPrivate ? "客服私推渠道" : exp.room_code === "unassigned" ? "归属待核对" : exp.room_code;
        const bucket = channelMap.get(key) ?? {
          id: key,
          name,
          roomCode: isPrivate ? "" : exp.room_code,
          isPrivate,
          count: 0,
          turnoverCents: 0n,
          materialCostCents: 0n,
          afterSaleCostCents: 0n
        };
        bucket.afterSaleCostCents += moneyToCents(exp.amount_cny);
        channelMap.set(key, bucket);
      }
      const channelBuckets = [...channelMap.values()].sort((a, b) => {
        if (a.isPrivate !== b.isPrivate) return a.isPrivate ? 1 : -1;
        return Number(b.turnoverCents - a.turnoverCents);
      });
      const channelWeights = channelBuckets.map((b) => b.turnoverCents);
      const allocatedAds = allocateByWeight(periodAdSpendCnyCents, channelWeights);
      const allocatedFees = allocateByWeight(periodThirdPartyFeeCents, channelWeights);
      const channelProfits = channelBuckets.map((b, idx) => {
        const matAndAfter = b.materialCostCents + b.afterSaleCostCents;
        const adCents = allocatedAds[idx] ?? 0n;
        const feeCents = allocatedFees[idx] ?? 0n;
        const gpCents = b.turnoverCents - matAndAfter - feeCents - adCents;
        return {
          id: b.id,
          name: b.name,
          roomCode: b.roomCode,
          isPrivate: b.isPrivate,
          count: b.count,
          turnover: centsToMoney(b.turnoverCents),
          materialAndAfterSale: centsToMoney(matAndAfter),
          thirdPartyFee: centsToMoney(feeCents),
          adSpendCny: centsToMoney(adCents),
          grossProfit: centsToMoney(gpCents),
          grossMargin: ratioPercent(gpCents, b.turnoverCents)
        };
      });

      const buildDayRow = (date: string) => {
        const dayOrders = allOrders.filter((row) => row.business_date === date);
        const dayValid = validWindowOrders.filter((row) => row.business_date === date);
        const dayTurnover = dayValid.reduce((s, r) => s + moneyToCents(r.booking_amount), 0n);
        const dayMat = dayValid.reduce((s, r) => s + materialCostForOrder(r).cents, 0n);
        const dayAfterSale = validAfterSaleExpenses
          .filter((e) => e.business_date === date)
          .reduce((s, e) => s + moneyToCents(e.amount_cny), 0n);
        const dayFee = settlementRows
          .filter((s) => s.settled_on === date)
          .reduce((s, item) => s + convertToCnyCents(item.fee_amount, item.fee_currency, item.fx_rate), 0n);
        const dayAdUsd = opsAdRows
          .filter((a) => a.business_date === date && a.spend_usd != null)
          .reduce((s, a) => s + moneyToCents(a.spend_usd!), 0n);
        const dayAdCny = convertToCnyCents(centsToMoney(dayAdUsd), "USD", null);
        const dayDailyOp = expenseRows
          .filter((e) => e.date === date)
          .reduce((s, e) => s + moneyToCents(e.amount), 0n);
        const dayReimOp = approvedReimbursementRows
          .filter((r) => r.date === date)
          .reduce((s, r) => s + moneyToCents(r.amount), 0n);
        const dayOp = dayDailyOp + dayReimOp;
        const hasSalesOrActivity = dayOrders.length > 0 || dayAdUsd > 0n || dayAfterSale > 0n || dayFee > 0n;
        const hasGrossActivity = dayOrders.length > 0 || dayAdUsd > 0n || dayAfterSale > 0n || dayFee > 0n;
        return {
          date,
          total: dayOrders.length > 0 ? centsToMoney(dayTurnover) : null,
          grossProfit: hasGrossActivity ? centsToMoney(dayTurnover - dayMat - dayAfterSale - dayFee - dayAdCny) : null,
          adSpendCny: dayAdUsd > 0n ? centsToMoney(dayAdCny) : (hasSalesOrActivity ? "0.00" : null),
          adSpendUsd: dayAdUsd > 0n ? centsToMoney(dayAdUsd) : null,
          operatingCost: (dayDailyOp > 0n || dayReimOp > 0n || hasSalesOrActivity) ? centsToMoney(dayOp) : null
        };
      };

      const days = daysBetween(period.from, period.to).map((date) => {
        const hasAny = periodOrders.some((row) => row.business_date === date);
        const dayValid = validOrders.filter((row) => row.business_date === date);
        return {
          date,
          total: hasAny ? statsOf(dayValid).total : null,
          operatingCost: null as string | null
        };
      });

      const trend = daysBetween(trendFrom, period.to).map(buildDayRow);

      res.set("Cache-Control", "private, no-store").json({
        version: "boss-priority/v1",
        period,
        performance: {
          ...periodPerf,
          afterSales: centsToMoney(periodAfterSalesCents),
          avgOrder: centsToMoney(periodAvgOrderCents)
        },
        grossProfit: {
          amount: centsToMoney(periodGrossProfitCents),
          margin: periodGrossMargin,
          materialCost: centsToMoney(periodMaterialCostCents),
          afterSaleCost: centsToMoney(periodAfterSaleCostCents),
          thirdPartyFee: centsToMoney(periodThirdPartyFeeCents),
          adSpendUsd: centsToMoney(periodAdSpendUsdCents),
          adSpendCny: centsToMoney(periodAdSpendCnyCents),
          missingMaterialCostCount
        },
        acquisition: {
          totalFans: totalFansCount,
          effectiveFans: hasEffectiveFans ? effectiveFansCount : null,
          costPerEffectiveFanCny
        },
        structure: {
          estimatedNetProfit: centsToMoney(estimatedNetProfitCents),
          netMargin,
          includesPayroll: hasLockedPayroll,
          items: [
            { key: "material", label: "料子本钱", amount: centsToMoney(periodMaterialCostCents), ratio: ratioPercent(periodMaterialCostCents, periodTurnoverCents) },
            { key: "afterSaleAndFee", label: "售后与扣点", amount: centsToMoney(periodAfterSaleCostCents + periodThirdPartyFeeCents), ratio: ratioPercent(periodAfterSaleCostCents + periodThirdPartyFeeCents, periodTurnoverCents) },
            { key: "ads", label: "投流成本", amount: centsToMoney(periodAdSpendCnyCents), ratio: ratioPercent(periodAdSpendCnyCents, periodTurnoverCents) },
            { key: "operating", label: "已录运营成本", amount: centsToMoney(recordedSubtotalCents), ratio: ratioPercent(recordedSubtotalCents, periodTurnoverCents) },
            { key: "netProfit", label: "预估净利", amount: centsToMoney(estimatedNetProfitCents), ratio: netMargin }
          ]
        },
        attention: {
          pendingPaymentVerifications: Number(attentionCounts?.pending_verifications || 0),
          missingMaterialCostOrders: missingMaterialCostCount,
          pendingExpensesAndWarehouse: Number(attentionCounts?.pending_expenses || 0) + Number(attentionCounts?.pending_warehouse || 0)
        },
        days,
        trend,
        rooms,
        channelProfits,
        expenses: {
          registered: periodDailyExpenses.length ? centsToMoney(periodDailyTotalCents) : null,
          recordedSubtotal: centsToMoney(recordedSubtotalCents),
          dailyTotal: centsToMoney(periodDailyTotalCents),
          approvedReimbursements: centsToMoney(periodReimTotalCents),
          approvedReimbursementCount: periodReimRows.length,
          payrollTotal: hasLockedPayroll ? centsToMoney(payrollTotalCents) : null,
          payrollStatus: hasLockedPayroll ? "ready" : "pending_payroll",
          status: hasLockedPayroll ? "ready" : "incomplete",
          categories: EXPENSE_CATEGORIES.map((c) => {
            if (c.key === "salary") {
              return {
                key: c.key,
                label: c.label,
                amount: hasLockedPayroll ? centsToMoney(payrollTotalCents) : null,
                count: hasLockedPayroll ? payrollRows.length : 0,
                status: hasLockedPayroll ? "recorded" : "pending_payroll"
              };
            }
            const rows = periodDailyExpenses.filter((row) => row.category === c.key);
            const amount = rows.reduce((sum, row) => sum + moneyToCents(row.amount), 0n);
            return {
              key: c.key,
              label: c.label,
              amount: rows.length ? centsToMoney(amount) : null,
              count: rows.length,
              status: rows.length ? "recorded" : "unreported"
            };
          }),
          records: periodDailyExpenses
        },
        definitions: {
          performance: "直播间料价＋代购费，加客服私推料价；未付款开单计入，跑单和退款源单排除，售后追加另列。",
          grossProfit: "计算公式：有效业绩 - 料子本钱（白条价/库房结算价） - 售后公司成本 - 第三方扣点 - 投流成本（折合人民币）。",
          fans: "加粉及有效粉按业务日日报汇总；无效粉仅计主管已确认的客资，缺少复核明细显示待复核，不按零处理。",
          expenses: "公司运营成本包含日常运营（房租/水电/招待/其他）、已核报销（含直播间费用，不含已计入订单成本的业务垫付）与固定薪资；工资未核算时仍展示已登记运营开支并标注「工资待核」。"
        }
      });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client?.release();
    }
  });

  router.get("/cash-order-balances", async (req, res, next) => {
    if (req.actor?.role !== "boss") {
      next(new HttpError(403, "仅 BOSS 可查看订单待收款余额"));
      return;
    }
    let client: PoolClient | undefined;
    try {
      const today = businessToday(new Date(), config.businessTimezone);
      const asOf = queryText(req.query.asOf, 16) || today;
      if (!isIsoDate(asOf) || asOf > today) {
        throw new HttpError(400, "截止日期无效");
      }

      client = await db.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

      const rows = (
        await client.query<{
          id: string;
          order_ref: string;
          customer_label: string | null;
          customer_code: string;
          operator_name: string;
          service_account: string;
          live_room_code: string;
          host_name: string;
          persona_name: string;
          business_date: string;
          currency: "CNY" | "TWD" | "USD" | "SGD" | "HKD";
          due_amount: string;
          paid_amount: string;
        }>(
          `SELECT o.id,
                  o.order_ref,
                  o.customer_label,
                  COALESCE(d.customer_code, '') AS customer_code,
                  COALESCE(NULLIF(trim(d.operator_name), ''), u.display_name, '') AS operator_name,
                  COALESCE(u.service_account_label, '') AS service_account,
                  COALESCE(NULLIF(trim(${liveRoomSql("d.live_room_code")}), ''), '') AS live_room_code,
                  COALESCE(d.host_name, '') AS host_name,
                  COALESCE(d.persona_name, '') AS persona_name,
                  o.business_date::text AS business_date,
                  COALESCE(d.customer_currency, 'CNY') AS currency,
                  (CASE WHEN d.order_id IS NULL THEN o.amount
                        ELSE d.customer_due + COALESCE((SELECT SUM(c.customer_amount) FROM order_charges c WHERE c.order_id = o.id AND c.voided_at IS NULL AND c.business_date <= $1), 0)
                   END)::numeric(14,2)::text AS due_amount,
                  COALESCE((SELECT SUM(p.credit_amount) FROM customer_payments p WHERE p.order_id = o.id AND p.voided_at IS NULL AND p.payment_date <= $1), 0)::numeric(14,2)::text AS paid_amount
             FROM orders o
             LEFT JOIN order_details d ON d.order_id = o.id
             LEFT JOIN users u ON u.id = o.user_id
            WHERE o.business_date <= $1
              AND o.status <> 'refunded'
              AND NOT EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id = o.id AND x.voided_at IS NULL)
            ORDER BY o.business_date DESC, o.order_ref`,
          [asOf]
        )
      ).rows;

      await client.query("COMMIT");

      const orders = rows.map((r) => {
        const dueCents = moneyToCents(r.due_amount);
        const paidCents = moneyToCents(r.paid_amount);
        const balanceCents = dueCents > paidCents ? dueCents - paidCents : 0n;
        const status = balanceCents === 0n ? "paid" : paidCents > 0n ? "partial" : "unpaid";
        return {
          id: r.id,
          reference: r.order_ref,
          customerLabel: r.customer_label || "",
          customerCode: r.customer_code,
          operatorName: r.operator_name,
          serviceAccount: r.service_account,
          roomKey: r.live_room_code || "__unassigned__",
          roomCode: r.live_room_code || "未归属直播间",
          hostName: r.host_name,
          personaName: r.persona_name,
          bookingDate: r.business_date,
          currency: r.currency,
          due: centsToMoney(dueCents),
          paid: centsToMoney(paidCents),
          balance: centsToMoney(balanceCents),
          status,
          bookedInPeriod: r.business_date === asOf
        };
      });

      res.set("Cache-Control", "private, no-store").json({ asOf, orders });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client?.release();
    }
  });

  router.get("/ops-workspace", async (req, res, next) => {
    if (!req.actor || !["boss", "ops"].includes(req.actor.role)) {
      next(new HttpError(403, "仅 BOSS 与运营可查看运营工作台范围"));
      return;
    }
    try {
      const userFilter = req.actor.role === "ops" ? req.actor.id : null;
      const [accRes, repRes] = await Promise.all([
        db.query<{ code: string; name: string }>(
          `SELECT code, name FROM ad_accounts ORDER BY code ASC`
        ),
        db.query<{ ad_account_ref: string | null; platform: string | null; persona_name: string }>(
          `SELECT DISTINCT ad_account_ref, platform, persona_name
             FROM ops_reports
            WHERE ($1::uuid IS NULL OR user_id = $1)
            ORDER BY ad_account_ref NULLS LAST, persona_name ASC`,
          [userFilter]
        )
      ]);
      const byAccount = new Map<string, { id: string; label: string; platform: string; personas: Set<string> }>();
      for (const a of accRes.rows) {
        byAccount.set(a.code, { id: a.code, label: a.name || a.code, platform: "", personas: new Set() });
      }
      for (const r of repRes.rows) {
        const accId = (r.ad_account_ref ?? "").trim();
        if (!accId) continue;
        let entry = byAccount.get(accId);
        if (!entry) {
          entry = { id: accId, label: accId, platform: "", personas: new Set() };
          byAccount.set(accId, entry);
        }
        if (r.platform && !entry.platform) entry.platform = r.platform;
        const p = (r.persona_name ?? "").trim();
        if (p) entry.personas.add(p);
      }
      const accounts = [...byAccount.values()]
        .filter((a) => req.actor!.role !== "ops" || a.personas.size > 0 || accRes.rows.some((x) => x.code === a.id))
        .map((a) => ({
          id: a.id,
          label: a.label,
          platform: a.platform,
          personas: [...a.personas].sort()
        }));
      const me = { id: req.actor.id, name: req.actor.displayName, code: req.actor.username };
      res.json({ people: [me], current: me, accounts, loginEnabled: false });
    } catch (error) {
      next(error);
    }
  });

  router.get("/ops-analysis", async (req, res, next) => {
    if (!req.actor || !["boss", "ops"].includes(req.actor.role)) {
      next(new HttpError(403, "仅 BOSS 与运营可查看投放分析"));
      return;
    }
    let client: PoolClient | undefined;
    try {
      const today = businessToday(new Date(), config.businessTimezone);
      const preset = queryText(req.query.preset) || "day";
      let period: { from: string; to: string };
      try {
        period = resolvePeriod(
          queryText(req.query.preset) || undefined,
          queryText(req.query.from) || undefined,
          queryText(req.query.to) || undefined,
          today
        );
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : "日期范围无效");
      }
      const dimensionRaw = queryText(req.query.dimension) || "persona";
      if (!Object.prototype.hasOwnProperty.call(OPS_DIMENSIONS, dimensionRaw)) {
        throw new HttpError(400, "分类维度无效");
      }
      const dimension = dimensionRaw as OpsDimension;
      const selected = {
        persona: queryText(req.query.persona),
        platform: queryText(req.query.platform),
        account: queryText(req.query.account),
        operator: queryText(req.query.operator)
      };
      const trendScope = queryText(req.query.trendScope);

      client = await db.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

      const rawRows = (
        await client.query<{
          id: string;
          user_id: string;
          operator_name: string;
          business_date: string;
          platform: string | null;
          persona_name: string;
          ad_account_ref: string | null;
          promo_video_count: number | null;
          promo_cost: string | null;
          spend_usd: string | null;
          consult_count: number | null;
          consult_cost_usd: string | null;
          click_count: number | null;
          ctr_percent: string | null;
          balance_usd: string | null;
          note: string | null;
          updated_at: string;
        }>(
          `SELECT r.id::text AS id,
                  r.user_id::text AS user_id,
                  COALESCE(u.display_name, '') AS operator_name,
                  r.business_date::text AS business_date,
                  r.platform,
                  r.persona_name,
                  r.ad_account_ref,
                  r.promo_video_count,
                  r.promo_cost::text AS promo_cost,
                  r.spend_usd::text AS spend_usd,
                  r.consult_count,
                  r.consult_cost_usd::text AS consult_cost_usd,
                  r.click_count,
                  r.ctr_percent::text AS ctr_percent,
                  r.balance_usd::text AS balance_usd,
                  r.note,
                  r.updated_at::text AS updated_at
             FROM ops_reports r
             LEFT JOIN users u ON u.id = r.user_id
            WHERE ($1::uuid IS NULL OR r.user_id = $1)`,
          [req.actor.role === "ops" ? req.actor.id : null]
        )
      ).rows;

      await client.query("COMMIT");

      const active: OpsRecord[] = rawRows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        operatorName: r.operator_name,
        businessDate: r.business_date,
        platform: r.platform || "",
        personaName: r.persona_name || "",
        adAccountRef: r.ad_account_ref || "",
        promoVideoCount: r.promo_video_count,
        promoCost: r.promo_cost || "0.00",
        spendUsd: r.spend_usd,
        consultCount: r.consult_count,
        consultCostUsd: r.consult_cost_usd,
        clickCount: r.click_count,
        ctrPercent: r.ctr_percent,
        balanceUsd: r.balance_usd,
        note: r.note || "",
        updatedAt: r.updated_at || ""
      }));

      const scoped = active.filter((r) =>
        (Object.entries(selected) as [OpsDimension, string][]).every(
          ([k, v]) => !v || (r[OPS_DIMENSIONS[k]] || "__unassigned__") === v
        )
      );
      const between = (rows: OpsRecord[], from: string, to: string) =>
        rows.filter((r) => r.businessDate >= from && r.businessDate <= to);

      const records = between(scoped, period.from, period.to).sort(
        (a, b) => b.businessDate.localeCompare(a.businessDate) || a.id.localeCompare(b.id)
      );
      const summary = computeOpsTotals(records);
      const dimField = OPS_DIMENSIONS[dimension];
      const groups = [...new Set(records.map((r) => r[dimField] || "__unassigned__"))].map((key) => ({
        key,
        name: key === "__unassigned__" ? "未关联" : key,
        ...computeOpsTotals(records.filter((r) => (r[dimField] || "__unassigned__") === key))
      }));

      const custom = !req.query.preset || preset === "custom";
      const prev = previousPeriod(custom ? "custom" : preset, period.from, period.to);
      const prevRecords = between(scoped, prev.from, prev.to);
      const trendFrom = trendScope === "period" ? period.from : addDays(period.to, -6);
      const trendDays = daysBetween(trendFrom, period.to).map((date) => ({
        date,
        partial: date === today,
        ...computeOpsTotals(scoped.filter((r) => r.businessDate === date))
      }));
      const accountBalances = computeOpsBalances(active, scoped, period.to);
      const totalUsd = accountBalances.length && accountBalances.every((a) => a.amountUsd != null)
        ? centsToMoney(accountBalances.reduce((sum, a) => sum + moneyToCents(a.amountUsd!), 0n))
        : null;

      res.set("Cache-Control", "private, no-store").json({
        version: "ops-analysis/v1",
        demo: false,
        period: { ...period, preset, custom, today, timezone: config.businessTimezone, partial: period.to === today },
        selected,
        dimension,
        summary,
        groups,
        records,
        scopeAccounts: [...new Set(scoped.map((r) => r.adAccountRef).filter(Boolean))].sort(),
        comparison: {
          label: prev.label,
          from: prev.from,
          to: prev.to,
          totals: computeOpsTotals(prevRecords),
          records: prevRecords,
          method: "reported_daily_totals",
          percentage: null
        },
        trend: {
          from: trendFrom,
          to: period.to,
          days: trendDays,
          records: between(scoped, trendFrom, period.to)
        },
        balances: {
          accounts: accountBalances,
          totalUsd,
          scope: "whole_account"
        },
        options: Object.fromEntries(
          (Object.entries(OPS_DIMENSIONS) as [OpsDimension, (typeof OPS_DIMENSIONS)[OpsDimension]][]).map(([k, field]) => [
            k,
            [...new Set(active.map((r) => r[field] || "__unassigned__"))].sort()
          ])
        ),
        fx: { ratesUsed: [], missing: [], referenceOnly: true },
        updatedAt: records.map((r) => r.updatedAt).filter(Boolean).sort().at(-1) || null,
        definitions: {
          spend: "广告实际消耗按日报业务日累计，单位USD；充值不是消耗。人民币是按发生日参考汇率逐笔四舍五入到分的分析折算，不是实际结汇。",
          consultations: "咨询量是运营日报上报计数相加，不作为跨日报去重客户人数；不等于客服加粉、有效线索或成交。",
          cost: "综合咨询成本＝同币种消耗总额÷总咨询量；零咨询或字段不全不计算。",
          clicks: "所选日报点击量相加，不作为独立客户人数。缺少曝光量，汇总点击率不计算；各日报原点击率保留。",
          comparison: "基准为运营已报的历史日汇总；今天尚未结束，且没有小时级数据，所以只列基准数，不声称同一时刻同比，不计算增长率。缺报日期不当作0。",
          balance: "每个相关广告账户取截止日最近一次余额快照，跨人设去重。筛选人设/平台后仍显示完整账户余额，不是该人设分配余额；余额冲突或缺失显示待核对。"
        }
      });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client?.release();
    }
  });

  return router;
}
