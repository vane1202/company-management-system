import { describe, expect, it } from "vitest";
import { isPayMonth, payrollAmountError, shiftMonth, signedLabel } from "./payrollUi";

describe("工资单前端辅助", () => {
  it("本月/上月按自然月切换，跨年正确", () => {
    expect(shiftMonth("2026-11-09")).toBe("2026-11");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01");
    expect(isPayMonth("2026-11")).toBe(true);
    expect(isPayMonth("2026-13")).toBe(false);
  });
  it("金额预检：正数、两位小数，0 和负数不可提交", () => {
    expect(payrollAmountError("12.30")).toBe("");
    expect(payrollAmountError("0")).not.toBe("");
    expect(payrollAmountError("0.00")).not.toBe("");
    expect(payrollAmountError("-1")).not.toBe("");
    expect(payrollAmountError("1.005")).not.toBe("");
    expect(signedLabel("deduction", "5.00")).toBe("− ¥ 5.00");
    expect(signedLabel("bonus", "5.00")).toBe("+ ¥ 5.00");
  });
});
