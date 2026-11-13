import { describe, expect, it } from "vitest";
import type { LiveBusinessData, Metrics } from "../api";
import { buildEstimateView, receiptLines, type EstimateSources } from "./estimateBoardData";

const metrics = {
  revenue: "2150.50", refunds: "180.00", promoCost: "0.00", salaryAllocated: "533.33",
  customProductCost: "1380.00", laborCost: "70.00", shippingCost: "30.00", estimate: "-42.83",
  orderCount: 2, promoVideoCount: 0, shootCount: 0, finishedCount: 0, publishedCount: 0,
  endingInventory: 0, fanAddedTotal: 0
} satisfies Metrics;

const legacy: EstimateSources = {
  period: { from: "2026-11-11", to: "2026-11-11" },
  metrics,
  formula: "收入 - 退款 - 历史推广费 - 工资 - 定制成本 - 工费 - 运费",
  disclaimer: "不是会计净利润",
  opsUsd: { spendUsd: "1.00" },
  overallSalary: { allocated: "533.33", note: "只扣底薪分摊" }
};

function live(): LiveBusinessData {
  return {
    period: { from: "2026-11-11", to: "2026-11-11" },
    totals: { performanceCny: "1770.50", expenseCny: "1415.00", customerReceipts: { CNY: "1290.50", TWD: "1200.00", USD: "140.00" } },
    ads: { spendUsd: "29.20" }
  } as LiveBusinessData;
}

describe("BOSS 经营估算展示", () => {
  it("开单、收款和花费分开保留，不合成利润", () => {
    const view = buildEstimateView(live(), legacy);
    expect(view?.turnover).toBe("1770.50");
    expect(view?.receipts).toEqual([["CNY", "1290.50"], ["TWD", "1200.00"], ["USD", "140.00"]]);
    expect(view?.expenseCny).toBe("1415.00");
    expect(view?.adUsd).toBe("29.20");
    expect(view).not.toHaveProperty("profit");
    expect(view?.legacy.find((line) => line.key === "estimate")?.value).toBe("-42.83");
    expect(view?.salary).toBe("533.33");
  });

  it("外币收款为零时不编造折算，广告消耗在直播数据缺失时沿用原值", () => {
    expect(receiptLines({ CNY: "0.00", TWD: "0.00", USD: "0.00" })).toEqual([["CNY", "0.00"]]);
    const view = buildEstimateView(null, legacy);
    expect(view?.turnover).toBeNull();
    expect(view?.adUsd).toBe("1.00");
    expect(view?.receipts).toEqual([]);
  });
});
