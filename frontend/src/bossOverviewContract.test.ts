import { describe, expect, it } from "vitest";
import {
  differenceDirectionLabel,
  finalContributionLabel,
  formatCny,
  formatDelta,
  formatFxRates,
  formatRoiPercent,
  displayOriginalAmounts,
  formatOriginalAmounts,
  formatRatioPercent,
  interpretOverviewHttpStatus,
  pendingCaliber,
  showMonthTarget,
  type BossOverviewResponse
} from "./bossOverviewContract";

describe("经营结论条：接口降级", () => {
  it("正式后端尚未实现时，404 视为数据待接入，其它失败不当作待接入", () => {
    expect(interpretOverviewHttpStatus(404)).toBe("not_implemented");
    expect(interpretOverviewHttpStatus(500)).toBe("error");
    expect(interpretOverviewHttpStatus(403)).toBe("error");
    expect(interpretOverviewHttpStatus(401)).toBe("error");
  });
});

describe("经营结论条：展示格式（不参与核算）", () => {
  it("原币种与汇率原文展示，不用经验值填空", () => {
    expect(formatOriginalAmounts([{ currency: "CNY", amount: "1290.50" }, { currency: "TWD", amount: "1200.00" }, { currency: "USD", amount: "140.00" }]))
      .toBe("CNY 1290.50 · TWD 1200.00 · USD 140.00");
    expect(displayOriginalAmounts({ original: [{ currency: "CNY", amount: "1770.50" }], cny_total: "1770.50" })).toBe("");
    expect(displayOriginalAmounts({ original: [{ currency: "USD", amount: "29.20" }], cny_total: "207.32" })).toBe("USD 29.20");
    expect(formatFxRates([
      { currency: "CNY", quote_currency: "CNY", rate: "1.000000", effective_on: "2026-01-01" },
      { currency: "USD", quote_currency: "CNY", rate: "7.100000", effective_on: "2026-11-01" }
    ])).toBe("1 USD = 7.100000 CNY（2026-11-01 起）");
    expect(formatCny(null, "missing_fx")).toBe("缺汇率，未折算");
    expect(formatCny(null)).toBe("—");
    expect(formatCny("938.18")).toBe("¥ 938.18");
    expect(formatRoiPercent("622.47")).toBe("622.47%");
    expect(formatRoiPercent("1235.05")).toBe("1235.05%");
    expect(formatRoiPercent(null)).toBe("—");
  });
  it("对比：无目标则隐藏；无基线显示破折号；比率按契约小数量出百分数", () => {
    expect(formatDelta(null, "昨").visible).toBe(false);
    expect(formatDelta({ amount_cny: null, ratio: null, baseline_cny: null, unavailable_reason: "no_target" }, "目标").visible).toBe(false);
    expect(formatDelta({ amount_cny: null, ratio: null, baseline_cny: null, unavailable_reason: "no_baseline" }, "周")).toEqual({ visible: true, text: "周 —" });
    expect(formatDelta({ amount_cny: "1770.50", ratio: null, baseline_cny: "0.00", unavailable_reason: "zero_baseline" }, "周")).toEqual({ visible: true, text: "周 —" });
    expect(formatDelta({ amount_cny: "370.50", ratio: "0.2646", baseline_cny: "1400.00", unavailable_reason: null }, "昨"))
      .toEqual({ visible: true, text: "昨 +370.50 +26.46%" });
    expect(formatDelta({ amount_cny: "-80.00", ratio: "-0.0500", baseline_cny: "1600.00", unavailable_reason: null }, "昨"))
      .toEqual({ visible: true, text: "昨 -80.00 -5.00%" });
    expect(formatRatioPercent("0.2646")).toBe("+26.46%");
    expect(showMonthTarget("month", false, false, { amount_cny: "1.00", ratio: "0.0100", baseline_cny: "100.00", unavailable_reason: null })).toBe(true);
    expect(showMonthTarget("month", false, true, { amount_cny: "1.00", ratio: "0.0100", baseline_cny: "100.00", unavailable_reason: null })).toBe(false);
    expect(showMonthTarget("day", false, false, { amount_cny: "1.00", ratio: "0.0100", baseline_cny: "100.00", unavailable_reason: null })).toBe(false);
    expect(showMonthTarget("month", true, false, { amount_cny: "1.00", ratio: "0.0100", baseline_cny: "100.00", unavailable_reason: null })).toBe(false);
  });
  it("已收款差额只展示后端方向，不在前端重算；最终净贡献在未录入时不回退预估", () => {
    expect(differenceDirectionLabel("customer_payments_higher")).toBe("客服登记高于财务核定");
    expect(differenceDirectionLabel("finance_higher")).toBe("财务核定高于客服登记");
    expect(finalContributionLabel({ status: "pending_finance", label: "待财务核算", value: { original: [], cny_total: "938.18", fx: [] } }))
      .toEqual({ pending: true, text: "待财务核算" });
    expect(finalContributionLabel({ status: "pending_finance", label: "待财务核算", value: null }))
      .toEqual({ pending: true, text: "待财务核算" });
    expect(finalContributionLabel({ status: "ready", label: "待财务核算", value: { original: [], cny_total: "100.00", fx: [], status: "ok" } }))
      .toEqual({ pending: false, text: "¥ 100.00" });
    expect(pendingCaliber({ caliber_pending: ["net_contribution_collection_source"] }, "net_contribution_collection_source")).toBe(true);
    expect(pendingCaliber({ caliber_pending: [] }, "roi_collection_source")).toBe(false);
  });
  it("契约示例类型可被前端完整读取（防止字段在展示层被合并）", () => {
    const sample: BossOverviewResponse = {
      period: { from: "2026-11-11", to: "2026-11-11", preset: "day" },
      fx: { status: "ok", missing_currencies: [], rates_used: [], prompt: null },
      updated_at: { customer_payments: null, paid_performance: null, live_expenses: null, ads: null, finance_costing: null },
      flags: { pending_finance: true, caliber_pending: [], missing_month_target: true },
      turnover: { original: [{ currency: "CNY", amount: "1770.50" }], cny_total: "1770.50", fx: [] },
      collections: {
        customer_payments: { original: [], cny_total: "2560.50", fx: [] },
        finance_paid_performance: { original: [], cny_total: "1290.50", fx: [] },
        difference: { original: [], cny_total: "1270.00", fx: [], direction: "customer_payments_higher" }
      },
      visible_cost: {
        total: { original: [], cny_total: "1622.32", fx: [] },
        live_expenses: { original: [], cny_total: "1415.00", fx: [] },
        ads: { original: [], cny_total: "207.32", fx: [] }
      },
      net_contribution: {
        estimated_note: "未扣料成本、提成、代收手续费",
        collection_source_used: "both",
        estimated_by_source: {
          customer_payments: { original: [], cny_total: "938.18", fx: [] },
          finance_paid_performance: { original: [], cny_total: "-331.82", fx: [] }
        },
        final: { status: "pending_finance", label: "待财务核算", value: null }
      },
      roi: {
        default_basis: "collections",
        available_bases: ["collections", "turnover"],
        collection_source_used: "both",
        values: {
          collections_by_source: {
            customer_payments: { value: "1235.05", unit: "percent", numerator_cny: "2560.50", denominator_cny: "207.32" },
            finance_paid_performance: { value: "622.47", unit: "percent", numerator_cny: "1290.50", denominator_cny: "207.32" }
          },
          turnover: { value: "853.99", unit: "percent", numerator_cny: "1770.50", denominator_cny: "207.32" }
        }
      }
    };
    expect(sample.collections.difference.cny_total).toBe("1270.00");
    expect(sample.net_contribution.final.value).toBeNull();
    expect(sample.net_contribution.estimated_by_source?.customer_payments.cny_total).toBe("938.18");
    expect(sample.net_contribution.estimated_by_source?.finance_paid_performance.cny_total).toBe("-331.82");
    expect(sample.flags.caliber_pending).toEqual([]);
    expect(sample.roi.values.collections_by_source?.finance_paid_performance.value).toBe("622.47");
    expect(sample.roi.values.turnover.unit).toBe("percent");
  });
});
