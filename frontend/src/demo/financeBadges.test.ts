import { describe, expect, it } from "vitest";
import { buildFinanceBadges } from "./financeBadges";

describe("buildFinanceBadges", () => {
  it("统计待审核、待核对和待付款，并提示本月未登记日常费用", () => {
    const badges = buildFinanceBadges({
      bills: [{ id: "b1", amount: "100.00", status: "submitted" }, { id: "b2", amount: "50.00", status: "approved" }, { id: "b3", amount: "30.00", status: "approved" }],
      billPayments: [{ billId: "b3", amount: "30.00" }],
      claims: [{ id: "c1", amount: "10.00", status: "pending" }, { id: "c2", amount: "20.00", status: "approved" }, { id: "c3", amount: "5.00", status: "rejected" }],
      claimPayments: [{ claimId: "c2", amount: "5.00" }],
      expenses: [{ date: "2026-10-30" }],
      month: "2026-11",
    });
    expect(badges.warehouse).toEqual({ text: "待审核 1 · 待付款 1", attention: true });
    expect(badges.reimbursement).toEqual({ text: "待核对 1 · 待付款 1", attention: true });
    expect(badges.dailyExpenses).toEqual({ text: "本月未登记", attention: true });
  });

  it("没有待办时不提示，已登记费用显示笔数", () => {
    const badges = buildFinanceBadges({ bills: [], billPayments: [], claims: [], claimPayments: [], expenses: [{ date: "2026-11-02" }, { date: "2026-11-09" }], month: "2026-11" });
    expect(badges.warehouse).toEqual({ text: "暂无待办", attention: false });
    expect(badges.dailyExpenses).toEqual({ text: "本月已登记 2 笔", attention: false });
  });
});