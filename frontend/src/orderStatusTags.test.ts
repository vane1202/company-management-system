import { describe, expect, it } from "vitest";
import { classifyOrderStatus, factsFromCrm, matchesStatusFilter } from "./orderStatusTags";

const base = { customerDue: "1980.00", basePaid: "0.00", basePaymentCount: 0, hasSplitPayment: false, hasFullPayment: false, shippedOn: null as string | null, chargeDue: "0.00", chargePaid: "0.00" };

describe("order status tags", () => {
  it("shows unpaid and unshipped", () => {
    const view = classifyOrderStatus(base);
    expect(view.tags.map(tag => tag.label)).toEqual(["待付款", "未发货"]);
    expect(view.followup).toBeNull();
  });
  it("shows the deposit balance", () => {
    const view = classifyOrderStatus({ ...base, basePaid: "1300.00", basePaymentCount: 1, hasSplitPayment: true });
    expect(view.payment).toBe("balance");
    expect(view.tags[0].label).toBe("补尾款");
    expect(view.followup).toBe("已付定金 ¥1,300.00 · 待补尾款 ¥680.00");
  });
  it("separates split settlement from one full payment", () => {
    const split = classifyOrderStatus({ ...base, basePaid: "1980.00", basePaymentCount: 2, hasSplitPayment: true });
    const full = classifyOrderStatus({ ...base, basePaid: "1980.00", basePaymentCount: 1, hasFullPayment: true });
    const namedBalance = classifyOrderStatus({ ...base, basePaid: "1980.00", basePaymentCount: 1, hasSplitPayment: true });
    expect(split.tags[0].label).toBe("已补尾款");
    expect(full.tags[0].label).toBe("已全款");
    expect(namedBalance.tags[0].label).toBe("已补尾款");
  });
  it("adds shipping, after-sales and sourcing tags", () => {
    const view = classifyOrderStatus({ ...base, basePaid: "1980.00", basePaymentCount: 1, hasFullPayment: true, shippedOn: "2026-11-26", chargeDue: "200.00", chargePaid: "0.00", hasSourcingNoSettle: true });
    expect(view.tags.map(tag => tag.label)).toEqual(["已全款", "已发货", "售后待收", "接待（PH）"]);
  });
  it("replaces payment and shipping when voided", () => {
    const ran = classifyOrderStatus({ ...base, cancelled: true, basePaid: "1980.00", shippedOn: "2026-11-26", hasSourcingNoSettle: true });
    const refunded = classifyOrderStatus({ ...base, status: "refunded" });
    expect(ran.tags.map(tag => tag.label)).toEqual(["已跑单", "接待（PH）"]);
    expect(ran.unshipped).toBe(false);
    expect(refunded.tags.map(tag => tag.label)).toEqual(["已退款"]);
  });
  it("filters by the same facts", () => {
    const view = classifyOrderStatus({ ...base, basePaid: "100.00", basePaymentCount: 1, hasSplitPayment: true, chargeDue: "50.00" });
    expect(matchesStatusFilter(view, "balance")).toBe(true);
    expect(matchesStatusFilter(view, "unshipped")).toBe(true);
    expect(matchesStatusFilter(view, "aftersales")).toBe(true);
    expect(matchesStatusFilter(view, "settled-full")).toBe(false);
  });
  it("counts a carried deposit as paid without a new receipt", () => {
    const facts = factsFromCrm({ cancelled: false, channel: "live", materialCents: 100000, feeCents: 10000, customerDueMinor: 110000, receipts: [], replacesId: "old", transferMinor: 110000 });
    expect(classifyOrderStatus(facts).tags[0].label).toBe("已补尾款");
    expect(facts.basePaymentCount).toBe(0);
  });
});
