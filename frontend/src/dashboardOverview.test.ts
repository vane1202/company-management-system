import { describe, expect, it } from "vitest";
import type { FanSummary } from "./api";
import { reportingOverview } from "./dashboardOverview";

function team(expected: number, reported: number): FanSummary {
  return { teamId: "team", teamName: "测试小组", totalAdded: 0, expectedCount: expected, reportedCount: reported, missingCount: expected - reported, missing: [], details: [] };
}
describe("Dashboard statistics", () => {
  it("does not invent a completion percentage before members are configured", () => {
    expect(reportingOverview([])).toEqual({ expected: 0, reported: 0, missing: 0, percentage: null });
  });
  it("counts reported members rather than customer increments or page records", () => {
    const first = { ...team(3, 2), totalAdded: 700 };
    expect(reportingOverview([first, team(2, 1)])).toEqual({ expected: 5, reported: 3, missing: 2, percentage: 60 });
  });
  it("keeps missing reports distinct from zero-valued submitted reports", () => {
    expect(reportingOverview([{ ...team(1, 1), totalAdded: 0 }]).percentage).toBe(100);
    expect(reportingOverview([team(1, 0)]).percentage).toBe(0);
  });
});
