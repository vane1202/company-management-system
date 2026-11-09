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

import { fanStateSegments, monthGap, sparkReady, MONTH_GAP_MIN_ABS } from "./dashboardDisplay";
describe("四种沟通状态占比", () => {
  it("合计等于加粉总数时不补段", () => {
    const r = fanStateSegments(7, { replied: 3, readNoReply: 1, unread: 2, invalid: 1 })!;
    expect(r.segments.map(s => s.value)).toEqual([3, 1, 2, 1]);
    expect(r.base).toBe(7); expect(r.overflow).toBe(0);
  });
  it("少于总数时补灰色未分类段，不按比例硬凑", () => {
    const r = fanStateSegments(20, { replied: 3, readNoReply: 1, unread: 2, invalid: 1 })!;
    expect(r.segments.at(-1)).toEqual({ key: "unclassified", label: "未分类", value: 13 });
    expect(r.segments.reduce((n, s) => n + s.value, 0)).toBe(20);
  });
  it("多于总数时如实给出多出数量；缺字段不画", () => {
    const r = fanStateSegments(5, { replied: 4, readNoReply: 1, unread: 1, invalid: 1 })!;
    expect(r.overflow).toBe(2); expect(r.base).toBe(7); expect(r.segments).toHaveLength(4);
    expect(fanStateSegments(5, { replied: 4, readNoReply: null, unread: 1, invalid: 1 })).toBeNull();
    expect(fanStateSegments(null, { replied: 1, readNoReply: 1, unread: 1, invalid: 1 })).toBeNull();
  });
});
describe("月累计（上报）与区间新增差异提示", () => {
  it("保守阈值：小差异不提示，大差异提示", () => {
    expect(monthGap(216, 9)).toEqual({ diff: 207, flagged: true });
    expect(monthGap(100, 95)).toEqual({ diff: 5, flagged: false });
    expect(monthGap(30, 30 - MONTH_GAP_MIN_ABS + 1)!.flagged).toBe(false);
    expect(monthGap(60, 30)!.flagged).toBe(true);
    expect(monthGap(200, 170)!.flagged).toBe(false);
    expect(monthGap(null, 3)).toBeNull();
  });
  it("趋势线至少需要两个有填报的日子", () => {
    expect(sparkReady([null, 3, null])).toBe(false);
    expect(sparkReady([1, null, 0])).toBe(true);
  });
});
