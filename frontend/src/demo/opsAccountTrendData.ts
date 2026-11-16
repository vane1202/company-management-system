import { convertAdSpend, getReferenceQuote, type FxQuote, type FxCurrency } from "./adExchangeRates";
import type { TrendSeries, TrendPoint } from "./bossTrendData";

export type OpsTrendRow = { businessDate: string; adAccountRef: string; spendUsd: string | null; consultCount: number | null };
export type OpsTrendMetric = "spendCny" | "consultCount" | "consultationCostCny" | "leads" | "invalidRate" | "leadCost";
const cents = (value: string) => { if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error("金额待核对"); const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")); };
const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;

export async function buildAccountTrends(rows: OpsTrendRow[], dates: string[], accounts: string[], metric: OpsTrendMetric, quote: (date: string, currency: FxCurrency) => Promise<FxQuote | null> = getReferenceQuote): Promise<TrendSeries[]> {
  const snapshots = new Map<string, Promise<FxQuote | null>>();
  const lookup = (date: string) => { if (!snapshots.has(date)) snapshots.set(date, quote(date, "USD")); return snapshots.get(date)!; };
  return Promise.all(accounts.map(async account => ({ key: "ops-account:" + account, label: account, points: await Promise.all(dates.map(async date => {
    const entries = rows.filter(row => row.adAccountRef === account && row.businessDate === date);
    const base: TrendPoint = { date, value: null, count: entries.length, reason: "未报", native: "", estimated: metric !== "consultCount" && metric !== "leads" && metric !== "invalidRate" };
    if (["leads", "invalidRate", "leadCost"].includes(metric)) return { ...base, reason: "客资来源与广告账户尚未准确关联" };
    if (!entries.length) return base;
    const consultations = entries.every(row => row.consultCount !== null && Number.isSafeInteger(row.consultCount) && row.consultCount >= 0) ? entries.reduce((sum, row) => sum + row.consultCount!, 0) : null;
    if (metric === "consultCount") return { ...base, value: consultations === null ? null : String(consultations), reason: consultations === null ? "咨询字段待补" : "" };
    try {
      const known = entries.filter(row => row.spendUsd !== null);
      const total = money(known.reduce((sum, row) => sum + cents(row.spendUsd!), 0n));
      const fx = await convertAdSpend(known.map(row => ({ date, amount: row.spendUsd! })), total, lookup, entries.length - known.length);
      if (fx.cny === null) return { ...base, reason: "参考汇率或消耗待补" };
      if (metric === "spendCny") return { ...base, value: fx.cny, reason: "", native: total + " USD" };
      if (!consultations) return { ...base, reason: consultations === null ? "咨询字段待补" : "零咨询，未计算" };
      return { ...base, value: money((cents(fx.cny) + BigInt(Math.floor(consultations / 2))) / BigInt(consultations)), reason: "" };
    } catch { return { ...base, reason: "金额或参考汇率待核对" }; }
  })) })));
}
