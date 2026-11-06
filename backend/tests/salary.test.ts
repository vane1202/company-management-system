import { describe, expect, it } from "vitest";
import { allocateSalaries } from "../src/lib/salary.js";

describe("月基本工资分摊", () => {
  it("整月覆盖时合计等于月薪，不会因按日取整产生尾差", () => {
    const row = { monthly_amount: "3000.00", effective_from: "2026-01-01", effective_to: null };
    expect(allocateSalaries([row], "2026-01-01", "2026-01-31")).toBe("3000.00");
    expect(allocateSalaries([row], "2026-11-01", "2026-11-30")).toBe("3000.00");
  });

  it("只覆盖一天时按当月天数分摊", () => {
    const row = { monthly_amount: "3000.00", effective_from: "2026-01-01", effective_to: null };
    expect(allocateSalaries([row], "2026-01-15", "2026-01-15")).toBe("96.77");
  });

  it("生效区间之外不计工资", () => {
    const row = { monthly_amount: "3000.00", effective_from: "2026-02-01", effective_to: "2026-02-10" };
    expect(allocateSalaries([row], "2026-01-01", "2026-01-31")).toBe("0.00");
  });
});
