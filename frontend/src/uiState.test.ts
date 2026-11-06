import { describe, expect, it } from "vitest";
import { canQueryByDate, isIsoDate, pickBusinessDate } from "./dates";
import { labelOrderStatus } from "./labels";
import { createRequestGate } from "./requestGate";
import { toErrorMessage } from "./errors";
import { readSessionMeta } from "./sessionMeta";
import { canAccessDashboard, canAccessSalaries, canReviewDaily, navItems, roleLabel } from "./access";
import { emptyDailyMetrics, labelReviewStatus, pickDailyByStatus, shouldShowStatusNetProfit } from "./reviewUi";

describe("前端日期默认值与请求守卫", () => {
  it("登录后的 today 才允许作为 date input 初始值", () => {
    expect(pickBusinessDate("", "")).toBe("");
    expect(pickBusinessDate("2026-11-06", "")).toBe("2026-11-06");
    expect(isIsoDate("")).toBe(false);
    expect(canQueryByDate("")).toBe(false);
    expect(canQueryByDate("2026-11-06")).toBe(true);
  });

  it("从登录或 /me 载荷读取业务日，忽略无效值", () => {
    expect(readSessionMeta({ today: "2026-11-06", disclaimer: "x" }).today).toBe("2026-11-06");
    expect(readSessionMeta({ today: "" }).today).toBe("");
    expect(readSessionMeta({ today: "11/06" }).today).toBe("");
    expect(readSessionMeta(undefined).today).toBe("");
  });

  it("订单状态显示中文", () => {
    expect(labelOrderStatus("placed")).toBe("下单");
    expect(labelOrderStatus("in_production")).toBe("制作中");
    expect(labelOrderStatus("shipped")).toBe("已发货");
    expect(labelOrderStatus("refunded")).toBe("退款");
  });
});

describe("周期切换时旧请求不能覆盖新选择", () => {
  it("多次切换后只接受最后一次结果", async () => {
    const gate = createRequestGate();
    const seen: string[] = [];
    async function load(preset: string, delay: number) {
      const ticket = gate.next();
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!ticket.isCurrent()) return;
      seen.push(preset);
    }
    await Promise.all([load("day", 30), load("week", 20), load("month", 5)]);
    expect(seen).toEqual(["month"]);
  });
});

describe("前端错误信息", () => {
  it("能从 Error 或字符串取出可读消息，空值时用回退文案", () => {
    expect(toErrorMessage(new Error("无权查看"))).toBe("无权查看");
    expect(toErrorMessage("网络中断")).toBe("网络中断");
    expect(toErrorMessage({}, "加载失败")).toBe("加载失败");
  });
});


describe("助理审核与手机状态展示", () => {
  it("助理中文名称是助理，只能进入审核不能看工资和经营估算", () => {
    expect(roleLabel.assistant).toBe("助理");
    const items = navItems("assistant").map((item) => item.id);
    expect(items).toContain("review");
    expect(items).not.toContain("salaries");
    expect(items).not.toContain("dashboard");
    expect(items).not.toContain("people");
    expect(canReviewDaily("assistant")).toBe(true);
    expect(canAccessSalaries("assistant")).toBe(false);
    expect(canAccessDashboard("assistant")).toBe(false);
    expect(canAccessSalaries("boss")).toBe(true);
  });

  it("审核状态有中文，且不会把三态混成一个净利润", () => {
    expect(labelReviewStatus("pending")).toBe("待审");
    expect(labelReviewStatus("rejected")).toBe("退回");
    expect(labelReviewStatus("approved")).toBe("通过");
    expect(shouldShowStatusNetProfit()).toBe(false);
    const pending = { ...emptyDailyMetrics(), revenue: "10.00" };
    const approved = { ...emptyDailyMetrics(), revenue: "20.00" };
    const rejected = { ...emptyDailyMetrics(), revenue: "3.00" };
    const picked = pickDailyByStatus({ pending, approved, rejected }, "approved");
    expect(picked.revenue).toBe("20.00");
    expect(picked.revenue).not.toBe("33.00");
  });
});
