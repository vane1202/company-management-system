import { describe, expect, it } from "vitest";
import type { FanSummary } from "./api";
import { effectiveOrderAmount, missingReporters, payrollStatusSplit, signedCents, yuan } from "./dashboardDisplay";

describe("订单有效金额（展示）", () => {
  it("订单金额含退款源订单，有效金额 = 订单金额 − 退款", () => {
    expect(effectiveOrderAmount("2150.50", "180.00")).toBe("1970.50");
    expect(effectiveOrderAmount("1970.50", "0.00")).toBe("1970.50");
    expect(effectiveOrderAmount("0.00", "0.00")).toBe("0.00");
  });
  it("缺数据或格式异常时不编造金额", () => {
    expect(effectiveOrderAmount(undefined, "0.00")).toBeNull();
    expect(effectiveOrderAmount("abc", "0.00")).toBeNull();
    expect(yuan(null)).toBe("—");
    expect(yuan("1970.50")).toBe("¥ 1970.50");
  });
  it("大额按分精确计算，不走浮点", () => {
    expect(effectiveOrderAmount("1234567890.13", "0.03")).toBe("1234567890.10");
    expect(signedCents("-200.00")).toBe(-20000n);
    expect(signedCents("−5")).toBe(-500n);
  });
});

describe("今日未报账号", () => {
  const team = (name: string, missing: { userId: string; displayName: string }[]): FanSummary => ({ teamId: name, teamName: name, totalAdded: 0, expectedCount: 2, reportedCount: 2 - missing.length, missingCount: missing.length, missing, details: [] });
  it("按小组顺序列出并去重；全部已报时为空", () => {
    expect(missingReporters([team("一组", [{ userId: "a", displayName: "WX_A" }]), team("二组", [{ userId: "a", displayName: "WX_A" }, { userId: "b", displayName: "WX_B" }])]))
      .toEqual([{ userId: "a", displayName: "WX_A", teamName: "一组" }, { userId: "b", displayName: "WX_B", teamName: "二组" }]);
    expect(missingReporters([team("一组", [])])).toEqual([]);
    expect(missingReporters(null)).toEqual([]);
  });
});

describe("工资单按状态拆分（只展示，不改合计口径）", () => {
  const rows = [
    { userId: "ops", displayName: "演示运营", net: "7180.50", status: "locked" as const },
    { userId: "ed", displayName: "演示拍剪", net: "5500.00", status: "draft" as const },
    { userId: "sup", displayName: "演示客服主管", net: "-200.00", status: "draft" as const }
  ];
  it("已锁定 + 草稿 = 后端实发合计；负数仍计入草稿合计并单列", () => {
    const s = payrollStatusSplit(rows, "12480.50")!;
    expect(s.locked).toEqual({ count: 1, net: "7180.50" });
    expect(s.draft).toEqual({ count: 2, net: "5300.00" });
    expect(s.negatives).toEqual([{ userId: "sup", displayName: "演示客服主管", net: "-200.00", status: "draft" }]);
    expect(s.matchesTotal).toBe(true);
  });
  it("与合计不一致时标记，界面据此不显示拆分", () => {
    expect(payrollStatusSplit(rows, "12680.50")!.matchesTotal).toBe(false);
    expect(payrollStatusSplit([{ ...rows[0], net: "x" }], "1.00")).toBeNull();
    expect(payrollStatusSplit([], "0.00")).toEqual({ locked: { count: 0, net: "0.00" }, draft: { count: 0, net: "0.00" }, negatives: [], matchesTotal: true });
  });
});
