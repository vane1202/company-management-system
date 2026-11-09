import { describe, expect, it } from "vitest";
import { monthBounds, parsePayMonth, payslipTotals } from "../src/lib/payroll.js";

describe("月度工资单计算（纯函数）", () => {
  it("实发 = 底薪 + 提成 + 奖金 − 扣款，精确到分，作废项目不计", () => {
    expect(payslipTotals("3000.10", [
      { kind: "commission", amount: "0.01" }, { kind: "commission", amount: "1200.335".slice(0, 7) },
      { kind: "bonus", amount: "200.00" }, { kind: "deduction", amount: "50.55" },
      { kind: "bonus", amount: "9999.99", voided: true }
    ])).toEqual({ base: "3000.10", commission: "1200.34", bonus: "200.00", deduction: "50.55", net: "4349.89", netNegative: false });
  });
  it("扣款大于应发时保留负数并标记，不截断为 0", () => {
    expect(payslipTotals("100.00", [{ kind: "deduction", amount: "150.25" }])).toMatchObject({ net: "-50.25", netNegative: true });
    expect(payslipTotals("0.00", [])).toMatchObject({ net: "0.00", netNegative: false });
  });
  it("月份格式与自然月边界", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    for (const bad of ["2026-13", "2026-1", "26-01", "2026-00", "", "1999-12"]) expect(() => parsePayMonth(bad)).toThrow();
  });
});
