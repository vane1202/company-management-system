import { describe, expect, it } from "vitest";
import type { AssessmentLead, EmployeeRecord } from "./assessmentFoundation";
import { shareLabel } from "./assessmentFoundation";
import { customerDesk, openingSnapshot, topBookers, type DeskCustomer } from "./supervisorHomeModel";

const employee = (id: string, teamId: string): EmployeeRecord => ({ id, code: id, name: id, status: "active", teamId });
const lead = (employeeId: string, contact: AssessmentLead["contact"], qualified = false): AssessmentLead => ({ id: employeeId + contact + qualified, accountId: "a", businessDate: "2026-11-15", employeeId, pageName: "page", channel: "ms", contact, qualified, invalidReason: "" });
const customer = (id: string, employeeId: string, status: DeskCustomer["status"], tier: DeskCustomer["spendTier"] = "", pending = false): DeskCustomer => ({ id, name: id, employeeId, employeeName: employeeId, spendTier: tier, status, pending, sample: false, createdOn: "2026-11-15", need: "" });

describe("supervisor home", () => {
  it("counts only this team's replied leads from today", () => {
    const rows = openingSnapshot([
      lead("jia", "replied", true), lead("jia", "replied"), lead("jia", "invalid"), lead("yi", "replied", true), lead("old", "replied", true)
    ].map((item, index) => index === 4 ? { ...item, businessDate: "2026-11-14" } : item), [employee("jia", "team-a"), employee("yi", "team-b")], "2026-11-15", ["team-a"]);
    expect(rows.replied).toBe(2);
    expect(rows.qualified).toBe(1);
    expect(rows.rate).toBe(shareLabel(1, 2));
  });
  it("groups current customers and leaves confirmed invalid leads out", () => {
    const desk = customerDesk([
      customer("a", "rong", "valid", "A"), customer("b", "rong", "dealt", "B"), customer("c", "rong", "invalid", "C", true), customer("d", "jie", "valid", "", true)
    ], [{ id: "qiu", name: "qiu" }]);
    expect(desk.following).toBe(3);
    expect(desk.dealt).toBe(1);
    expect(desk.pending).toBe(1);
    expect(desk.tiers).toEqual({ A: 1, B: 1, C: 0 });
    expect(desk.people.map((person) => [person.name, person.following, person.pending])).toEqual([["rong", 2, 0], ["jie", 1, 1], ["qiu", 0, 0]]);
  });
  it("ranks only people with bookings", () => {
    const rows = topBookers([{ name: "yi", count: 1, turnover: 10n }, { name: "jia", count: 2, turnover: 30n }, { name: "bing", count: 0, turnover: 0n }, { name: "ding", count: 1, turnover: 30n }]);
    expect(rows.map((row) => row.name)).toEqual(["ding", "jia", "yi"]);
  });
});
