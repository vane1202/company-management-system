import { requestInner } from "./api";
import { toErrorMessage } from "./errors";

/** P0 结论条契约类型。字段与 docs/BOSS_OVERVIEW_API_CONTRACT_DRAFT.md 对齐；契约所有权在 Codex。 */

export const BOSS_OVERVIEW_CONTRACT_VERSION = "0.1-draft";
export const BOSS_OVERVIEW_PATH = "/api/dashboard/boss-overview";

export type CurrencyCode = "CNY" | "TWD" | "USD";

export type FxRateUsed = {
  currency: string;
  quote_currency: "CNY";
  rate: string;
  effective_on: string;
  source?: string;
};

export type MoneyOriginal = { currency: CurrencyCode | string; amount: string };

export type ComparisonDelta = {
  amount_cny: string | null;
  ratio: string | null;
  baseline_cny: string | null;
  period?: { from: string; to: string };
  unavailable_reason: "missing_fx" | "no_baseline" | "no_target" | "zero_baseline" | null;
};

export type MetricComparison = {
  vs_yesterday: ComparisonDelta | null;
  vs_same_weekday_last_week: ComparisonDelta | null;
  vs_month_target: ComparisonDelta | null;
};

export type MoneyMetric = {
  original: MoneyOriginal[];
  cny_total: string | null;
  fx: FxRateUsed[];
  status?: "ok" | "missing_fx" | "caliber_pending" | "pending_finance" | "not_available";
  comparison?: MetricComparison;
};

export type RatioMetric = {
  value: string | null;
  unit?: "multiple" | "percent";
  numerator_cny: string | null;
  denominator_cny: string | null;
  comparison?: MetricComparison;
  status?: MoneyMetric["status"];
};

export type BossOverviewResponse = {
  contract_version?: string;
  disclaimer?: string;
  period: { from: string; to: string; preset: "day" | "week" | "month" | string; label?: string };
  fx: {
    status: "ok" | "missing_rate" | "missing_fx";
    missing_currencies: string[];
    rates_used: FxRateUsed[];
    prompt: string | null;
  };
  updated_at: {
    customer_payments: string | null;
    paid_performance: string | null;
    live_expenses: string | null;
    ads: string | null;
    finance_costing: string | null;
    fx_rates?: string | null;
  };
  flags: {
    pending_finance: boolean;
    caliber_pending: string[];
    missing_month_target: boolean;
    live_entry_pending?: boolean;
  };
  turnover: MoneyMetric;
  collections: {
    customer_payments: MoneyMetric;
    finance_paid_performance: MoneyMetric;
    difference: MoneyMetric & { direction?: "customer_payments_higher" | "finance_higher" | "equal" | "unknown"; formula?: string };
  };
  visible_cost: {
    total: MoneyMetric;
    live_expenses: MoneyMetric;
    ads: MoneyMetric;
  };
  net_contribution: {
    estimated_note: string;
    collection_source_used: "both" | "pending" | "customer_payments" | "finance_paid_performance";
    estimated?: MoneyMetric;
    estimated_by_source?: {
      customer_payments: MoneyMetric;
      finance_paid_performance: MoneyMetric;
    };
    final: {
      status: "pending_finance" | "ready";
      label: string;
      value: MoneyMetric | null;
      components?: {
        material_cost: MoneyMetric | null;
        commission: MoneyMetric | null;
        collection_fee: MoneyMetric | null;
        granularity?: "pending" | "daily" | "per_order";
      };
    };
  };
  roi: {
    default_basis: "collections" | "turnover";
    available_bases: Array<"collections" | "turnover">;
    collection_source_used: "both" | "pending" | "customer_payments" | "finance_paid_performance";
    values: {
      collections?: RatioMetric;
      collections_by_source?: {
        customer_payments: RatioMetric;
        finance_paid_performance: RatioMetric;
      };
      turnover: RatioMetric;
    };
  };
};

export type BossOverviewLoad =
  | { status: "ready"; data: BossOverviewResponse }
  | { status: "not_implemented" }
  | { status: "error"; message: string };

export function interpretOverviewHttpStatus(status: number): "not_implemented" | "error" {
  return status === 404 ? "not_implemented" : "error";
}

export async function loadBossOverview(preset: string, range?: { from: string; to: string }): Promise<BossOverviewLoad> {
  try {
    const params = new URLSearchParams({ preset, ...(range ?? {}) });
    const data = await requestInner<BossOverviewResponse>(`${BOSS_OVERVIEW_PATH}?${params}`);
    return { status: "ready", data };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status != null && interpretOverviewHttpStatus(status) === "not_implemented") {
      return { status: "not_implemented" };
    }
    return { status: "error", message: toErrorMessage(error, "未能读取经营结论") };
  }
}

export function formatCny(value: string | null | undefined, status?: MoneyMetric["status"]): string {
  if (status === "missing_fx" || (value == null && status === "not_available")) {
    return value == null ? "缺汇率，未折算" : `¥ ${value}`;
  }
  if (value == null || value === "") return "—";
  return `¥ ${value}`;
}

export function formatOriginalAmounts(original: MoneyOriginal[] | undefined): string {
  if (!original?.length) return "";
  return original.map(row => `${row.currency} ${row.amount}`).join(" · ");
}

/** 仅人民币且与折算合计相同时不再重复展示原币种行。 */
export function displayOriginalAmounts(metric?: Pick<MoneyMetric, "original" | "cny_total"> | null): string {
  const original = metric?.original ?? [];
  if (original.length === 1 && original[0].currency === "CNY" && original[0].amount === metric?.cny_total) return "";
  return formatOriginalAmounts(original);
}

export function formatFxRates(rates: FxRateUsed[] | undefined): string {
  const rows = (rates ?? []).filter(rate => rate.currency !== "CNY");
  if (!rows.length) return "";
  return rows.map(rate => `1 ${rate.currency} = ${rate.rate} ${rate.quote_currency}（${rate.effective_on} 起）`).join("；");
}

export function formatClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : value;
}

/** 把契约里的小数 ratio（如 0.2646）格式化为带符号百分数；缺 ratio 时回退到金额。不参与核算。 */
export function formatDelta(delta: ComparisonDelta | null | undefined, shortLabel: string): { visible: boolean; text: string } {
  if (!delta) return { visible: false, text: "" };
  if (delta.unavailable_reason === "no_target") return { visible: false, text: "" };
  if (delta.unavailable_reason === "no_baseline" || delta.unavailable_reason === "zero_baseline" || delta.unavailable_reason === "missing_fx") {
    return { visible: true, text: `${shortLabel} —` };
  }
  const parts = [shortLabel];
  if (delta.amount_cny != null) parts.push(signedNumber(delta.amount_cny));
  if (delta.ratio != null) parts.push(formatRatioPercent(delta.ratio));
  if (parts.length === 1) return { visible: true, text: `${shortLabel} —` };
  return { visible: true, text: parts.join(" ") };
}

export function formatRatioPercent(ratio: string): string {
  const signed = signedCents4(ratio);
  if (signed == null) return ratio;
  // ratio 0.2646（万分位 2646）= 26.46%，百分数保留两位。
  const negative = signed < 0n;
  const abs = negative ? -signed : signed;
  const whole = abs / 100n;
  const frac = String(abs % 100n).padStart(2, "0");
  return `${negative ? "-" : "+"}${whole}.${frac}%`;
}

/** ROI 展示为百分数，如 622.47%；value 已是百分数，不再乘 100。 */
export function formatRoiPercent(value: string | null | undefined): string {
  return value == null || value === "" ? "—" : `${value}%`;
}

export function showMonthTarget(preset: string | undefined, rangeSelected: boolean, flagMissing: boolean, delta: ComparisonDelta | null | undefined): boolean {
  if (flagMissing || rangeSelected || preset !== "month") return false;
  if (!delta || delta.unavailable_reason === "no_target") return false;
  return true;
}

export function differenceDirectionLabel(direction: string | undefined): string {
  if (direction === "customer_payments_higher") return "客服登记高于财务核定";
  if (direction === "finance_higher") return "财务核定高于客服登记";
  if (direction === "equal") return "两源一致";
  return "";
}

export function pendingCaliber(flags: { caliber_pending: string[] } | undefined, key: string): boolean {
  return !!flags?.caliber_pending.includes(key);
}

/** 最终净贡献：未录入时只返回「待财务核算」，绝不回退到预估值。 */
export function finalContributionLabel(final: BossOverviewResponse["net_contribution"]["final"] | undefined): { pending: boolean; text: string } {
  if (!final || final.status === "pending_finance" || final.value == null) {
    return { pending: true, text: final?.label || "待财务核算" };
  }
  return { pending: false, text: formatCny(final.value.cny_total, final.value.status) };
}

function signedNumber(value: string): string {
  return value.startsWith("-") || value.startsWith("−") ? value : `+${value}`;
}

/** 把带最多 4 位小数的有符号小数读成 1e-4 整数；不合法返回 null。 */
function signedCents4(value: string): bigint | null {
  const m = /^(-|−)?(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) return null;
  const frac = (m[3] ?? "").padEnd(4, "0");
  const abs = BigInt(m[2]) * 10000n + BigInt(frac);
  return m[1] ? -abs : abs;
}
