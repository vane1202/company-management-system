import { describe, expect, it, vi } from "vitest";
import { buildAccountTrends, type OpsTrendRow } from "./opsAccountTrendData";
import type { FxCurrency } from "./adExchangeRates";
const dates = ["2026-11-13", "2026-11-14", "2026-11-15"];
const row = (account: string, date: string, spend: string | null, count: number | null): OpsTrendRow => ({ adAccountRef: account, businessDate: date, spendUsd: spend, consultCount: count });
const rows = [row("a", dates[0], "10.00", 2), row("a", dates[0], "20.00", 4), row("b", dates[0], "5.00", 1), row("a", dates[2], "0.00", 0)];
const quote = async (date: string, currency: FxCurrency) => ({ date, currency, rate: "7.000000", sourceDate: date, updatedAt: date + "T04:00:00Z", checkedAt: 0, source: "test", delayed: false, stale: false });
describe("多账号走势", () => {
  it("按账号聚合多个人设，逐日统一换算，缺报断点与明确零区分", async () => {
    const lookup = vi.fn(quote);
    const result = await buildAccountTrends(rows, dates, ["a", "b"], "spendCny", lookup);
    expect(result[0].points.map(p => p.value)).toEqual(["210.00", null, "0.00"]);
    expect(result[1].points.map(p => p.value)).toEqual(["35.00", null, null]);
    expect(lookup.mock.calls.filter(call => call[0] === dates[0])).toHaveLength(1);
  });
  it("综合咨询成本用总消耗除以总咨询；零咨询不作零成本", async () => {
    const result = await buildAccountTrends(rows, dates, ["a"], "consultationCostCny", quote);
    expect(result[0].points[0].value).toBe("35.00");
    expect(result[0].points[2].value).toBeNull();
    expect(result[0].points[2].reason).toContain("零咨询");
  });
  it("未建立客资关联时不冒充真实客户数或比例，空选择没有曲线", async () => {
    for (const metric of ["leads", "invalidRate", "leadCost"] as const) expect((await buildAccountTrends(rows, dates, ["a"], metric, quote))[0].points.every(p => p.value === null)).toBe(true);
    expect(await buildAccountTrends(rows, dates, [], "spendCny", quote)).toEqual([]);
    expect((await buildAccountTrends([row("a", dates[0], null, 1)], dates, ["a"], "spendCny", quote))[0].points[0].value).toBeNull();
  });
});
