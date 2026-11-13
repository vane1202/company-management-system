import type { Currency, LiveBusinessData, Metrics } from "../api";

export type LegacyLine = { key: string; label: string; value: string };
export type EstimateSources = {
  period: { from: string; to: string };
  metrics: Metrics;
  formula: string;
  disclaimer: string;
  opsUsd: { spendUsd: string };
  overallSalary?: { allocated: string; note: string };
};
export type EstimateView = {
  period: { from: string; to: string };
  turnover: string | null;
  receipts: [Currency, string][];
  expenseCny: string | null;
  adUsd: string | null;
  salary: string | null;
  salaryNote: string;
  legacy: LegacyLine[];
  formula: string;
  disclaimer: string;
};

const currencies: Currency[] = ["CNY", "TWD", "USD"];

/** Keep each currency. Do not add them or convert them into a profit. */
export function receiptLines(values?: Record<Currency, string>): [Currency, string][] {
  if (!values) return [];
  const rows = currencies
    .filter((currency) => values[currency] != null && Number(values[currency]) !== 0)
    .map((currency) => [currency, values[currency]] as [Currency, string]);
  return rows.length ? rows : [["CNY", "0.00"]];
}

export function buildEstimateView(live: LiveBusinessData | null, legacy: EstimateSources | null): EstimateView | null {
  if (!live && !legacy) return null;
  const metrics = legacy?.metrics;
  return {
    period: live?.period ?? legacy!.period,
    turnover: live?.totals.performanceCny ?? null,
    receipts: receiptLines(live?.totals.customerReceipts),
    expenseCny: live?.totals.expenseCny ?? null,
    adUsd: live?.ads.spendUsd ?? legacy?.opsUsd.spendUsd ?? null,
    salary: legacy?.overallSalary?.allocated ?? metrics?.salaryAllocated ?? null,
    salaryNote: legacy?.overallSalary?.note ?? "期间底薪分摊只作参考，不从开单营业额里扣成利润。",
    legacy: metrics
      ? [
          ["revenue", "订单金额（含退款源订单）", metrics.revenue],
          ["refunds", "退款金额", metrics.refunds],
          ["promoCost", "历史推广费（币种未知）", metrics.promoCost],
          ["salaryAllocated", "工资分摊", metrics.salaryAllocated],
          ["customProductCost", "定制成本", metrics.customProductCost],
          ["laborCost", "工费", metrics.laborCost],
          ["shippingCost", "运费", metrics.shippingCost],
          ["estimate", "旧口径余额", metrics.estimate]
        ].map(([key, label, value]) => ({ key, label, value }))
      : [],
    formula: legacy?.formula ?? "",
    disclaimer: legacy?.disclaimer ?? ""
  };
}
