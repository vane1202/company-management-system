import { describe, expect, it, vi } from "vitest";
import { convertCustomerPayments, createAdFxClient, type FxCurrency, type FxQuote } from "./adExchangeRates";

const now = Date.parse("2026-11-12T05:30:00Z");
const quote = async (date: string, currency: FxCurrency): Promise<FxQuote> => ({ currency, date, sourceDate: date, rate: currency === "USD" ? "7.000000" : "0.200000", source: "Exchangerate.dev", updatedAt: "2026-11-12T05:15:00Z", checkedAt: now, delayed: true, stale: false });
const rows = [{ date: "2026-11-12", amount: "1290.50", currency: "CNY" }, { date: "2026-11-12", amount: "1200.00", currency: "TWD" }, { date: "2026-11-12", amount: "140.00", currency: "USD" }];
const totals = { CNY: "1290.50", TWD: "1200.00", USD: "140.00" };
describe("客户付款统一人民币参考展示", () => {
  it("两处使用同一按付款日及币种折算，不用结算到账或扣点替代客户付款", async () => {
    const lookup = vi.fn(quote);
    const original = JSON.stringify(rows);
    const view = await convertCustomerPayments(rows, totals, lookup);
    expect(view.cny).toBe("2510.50"); expect(view.hasForeign).toBe(true);
    expect(lookup.mock.calls).toEqual([["2026-11-12", "TWD"], ["2026-11-12", "USD"]]);
    expect(JSON.stringify(rows)).toBe(original); expect(view).not.toHaveProperty("companyReceived");
  });
  it("历史付款按原付款日汇率，跨币种分组分别四舍五入", async () => {
    const lookup = vi.fn(async (date: string, currency: FxCurrency) => ({ ...await quote(date, currency), rate: date === "2026-11-11" ? "6.500000" : "7.000000" }));
    const view = await convertCustomerPayments([{ date: "2026-11-11", amount: "0.01", currency: "USD" }, { date: "2026-11-12", amount: "0.01", currency: "USD" }], { CNY: "0.00", TWD: "0.00", USD: "0.02" }, lookup);
    expect(view.cny).toBe("0.14");
  });
  it("缺少任一外币汇率时不将已有人民币显示为完整汇总", async () => {
    const view = await convertCustomerPayments(rows, totals, async (date, currency) => currency === "TWD" ? null : quote(date, currency));
    expect(view.cny).toBeNull(); expect(view.missingDates).toEqual(["2026-11-12 TWD"]);
  });
  it("纯人民币和真实零无需行情请求，也不标参考外币折算", async () => {
    const lookup = vi.fn(quote);
    const view = await convertCustomerPayments([rows[0]], { CNY: "1290.50", TWD: "0.00", USD: "0.00" }, lookup);
    expect(view.cny).toBe("1290.50"); expect(view.hasForeign).toBe(false); expect(lookup).not.toHaveBeenCalled();
    expect((await convertCustomerPayments([], { CNY: "0.00", TWD: "0.00", USD: "0.00" }, lookup)).cny).toBe("0.00");
  });
  it("总额与明细不一致、无效金额或币种不匹配时不出完整合计", async () => {
    expect((await convertCustomerPayments(rows, { ...totals, TWD: null }, quote)).cny).toBeNull();
    expect((await convertCustomerPayments(rows.slice(1), totals, quote)).incomplete).toBe(true);
    expect((await convertCustomerPayments(rows, totals, async date => quote(date, "USD"))).cny).toBeNull();
    expect((await convertCustomerPayments([{ ...rows[0], amount: "-1.00" }], totals, quote)).incomplete).toBe(true);
  });
  it("美元和台币缓存按币种隔离，广告与付款不会误用另一币种汇率", async () => {
    const cache = new Map<string, string>();
    const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value); } };
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ result: "success", base: url.includes("/TWD?") ? "TWD" : "USD", rates: { CNY: url.includes("/TWD?") ? 0.2 : 7 }, source: "live", data_updated_at: "2026-11-12T05:15:00Z" })));
    const usd = createAdFxClient({ storage, fetcher: fetcher as typeof fetch, now: () => now });
    const twd = createAdFxClient({ storage, fetcher: fetcher as typeof fetch, now: () => now, currency: "TWD" });
    expect((await usd.get("2026-11-12"))?.rate).toBe("7.000000"); expect((await twd.get("2026-11-12"))?.rate).toBe("0.200000"); expect(cache.size).toBe(2);
  });
});
