import { describe, expect, it } from "vitest";
import { detailLines } from "./dailyDetail";
import { navItems } from "./access";
describe("daily detail presentation", () => {
  it("keeps legacy data unclassified and distinguishes missing from zero", () => {
    const old = detailLines("fan_report", { addedCount: 15 });
    expect(old.join(" ")).toContain("15（统计不完整）");
    expect(old.join(" ")).toContain("Messenger 今日进粉：未记录");
    const detailed = detailLines("fan_report", { msToday: 0, wsToday: 0 });
    expect(detailed.join(" ")).toContain("Messenger 今日进粉：0");
    expect(detailed.join(" ")).not.toContain("未分类旧加粉");
  });
  it("shows independently reported USD consultation costs without recalculating", () => {
    const lines = detailLines("ops_report", { spendUsd: "29.20", consultCount: 1, consultCostUsd: "29.28", promoCost: "8.00", ctrPercent: "0.75", balanceUsd: "90.00" });
    expect(lines).toContain("每次咨询成本 USD：29.28");
    expect(lines).toContain("历史费用（币种未知）：8.00");
    expect(lines).toContain("点击率 %：0.75");
  });
  it("shows sent-to-ops separately from historical publication and includes notes", () => {
    const lines = detailLines("editor_report", { sentToOpsCount: 5, publishedCount: 2, note: "待复核" });
    expect(lines).toContain("发给运营：5");
    expect(lines).toContain("历史已发布：2");
    expect(lines).toContain("备注：待复核");
  });
  it("exposes module management only to system admin", () => {
    expect(navItems("admin").some((item) => item.id === "modules")).toBe(true);
    for (const role of ["boss", "assistant", "cs", "cs_supervisor", "ops", "editor"] as const) expect(navItems(role).some((item) => item.id === "modules")).toBe(false);
  });
});
