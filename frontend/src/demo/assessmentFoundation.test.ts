import { describe, expect, it } from "vitest";
import { applyHandover, attendanceShare, cohortFacts, contactFromNote, holderOn, orderPeople, reasonGap, shareLabel, type TenureRecord } from "./assessmentFoundation";

const tenures: TenureRecord[] = [
  { id: "old", accountId: "demo-wechat-3", employeeId: "former", startDate: "2026-10-01", endDate: "2026-11-11" },
  { id: "now", accountId: "demo-wechat-3", employeeId: "bing", startDate: "2026-11-12", endDate: null }
];

describe("assessment foundation", () => {
  it("uses the person who held the account on the business date", () => {
    expect(holderOn(tenures, "demo-wechat-3", "2026-11-09")?.employeeId).toBe("former");
    expect(holderOn(tenures, "demo-wechat-3", "2026-11-12")?.employeeId).toBe("bing");
    expect(holderOn(tenures, "demo-wechat-3", "2026-09-30")).toBeNull();
  });
  it("closes the old tenure on handover and leaves sealed facts unchanged", () => {
    const sealed = { employeeId: "former", businessDate: "2026-11-09", contact: "replied" as const, qualified: true };
    const result = applyHandover(tenures, { accountId: "demo-wechat-3", toEmployeeId: "newcomer", date: "2026-11-13", today: "2026-11-13", tenureId: "next" });
    if ("error" in result) throw new Error(result.error);
    expect(holderOn(result.tenures, "demo-wechat-3", "2026-11-09")?.employeeId).toBe("former");
    expect(holderOn(result.tenures, "demo-wechat-3", "2026-11-12")?.employeeId).toBe("bing");
    expect(holderOn(result.tenures, "demo-wechat-3", "2026-11-13")?.employeeId).toBe("newcomer");
    expect(sealed.employeeId).toBe("former");
    expect(cohortFacts([
      sealed,
      { employeeId: "former", businessDate: "2026-11-09", contact: "replied", qualified: false },
      { employeeId: "former", businessDate: "2026-11-09", contact: "invalid", qualified: true },
      { employeeId: "former", businessDate: "2026-11-09", contact: "read_no_reply", qualified: false }
    ])).toEqual([expect.objectContaining({ received: 4, replied: 2, qualified: 1, invalid: 1, openingRate: "50.0" })]);
  });
  it("calculates rates from people, not by averaging percentages", () => {
    expect(shareLabel(1, 2)).toBe("50% · 1/2人");
    expect(shareLabel(3, 12)).toBe("25% · 3/12人");
    expect(shareLabel(0, 4)).toBe("0% · 0/4人");
    expect(shareLabel(1, 0)).toBeNull();
    expect(attendanceShare(12, 3, "unlinked")).toBeNull();
    expect(attendanceShare(12, 3, "linked")).toBe("25.0");
    expect(attendanceShare(0, 0, "linked")).toBeNull();
  });
  it("counts one customer once when several stones share the booking day", () => {
    expect(orderPeople([
      { id: "1", accountId: "a", businessDate: "2026-11-13", customerLabel: "全義", employeeId: "jia", countsAsOrder: true },
      { id: "2", accountId: "a", businessDate: "2026-11-13", customerLabel: "全義", employeeId: "jia", countsAsOrder: true },
      { id: "3", accountId: "a", businessDate: "2026-11-13", customerLabel: "跑单", employeeId: "jia", countsAsOrder: false },
      { id: "4", accountId: "a", businessDate: "2026-11-13", customerLabel: "未归属", employeeId: null, countsAsOrder: true }
    ])).toEqual({ unassigned: 1, rows: [{ employeeId: "jia", businessDate: "2026-11-13", customers: 1 }] });
  });
  it("keeps silence out of the invalid categories", () => {
    expect(contactFromNote("已读不回").contact).toBe("read_no_reply");
    expect(contactFromNote("不会中文，开了口也听不懂").invalidReason).toBe("no_chinese");
    expect(contactFromNote("说自己按错咨询按钮").invalidReason).toBe("misclick");
    expect(contactFromNote("发送色情内容").invalidReason).toBe("obscene");
    expect(contactFromNote("白冰手镯，预算4000台币")).toEqual({ contact: "replied", invalidReason: "" });
    expect(reasonGap("16", ["", "", ""])).toEqual({ status: "missing", unspecified: null });
    expect(reasonGap("3", ["1", "1", "2"])).toEqual({ status: "over", unspecified: null });
    expect(reasonGap("16", ["10", "4", "1"])).toEqual({ status: "ok", unspecified: 1 });
  });
  it("rejects a handover to the same person or a future date", () => {
    expect("error" in applyHandover(tenures, { accountId: "demo-wechat-3", toEmployeeId: "bing", date: "2026-11-13", today: "2026-11-13", tenureId: "x" })).toBe(true);
    expect("error" in applyHandover(tenures, { accountId: "demo-wechat-3", toEmployeeId: "newcomer", date: "2026-11-14", today: "2026-11-13", tenureId: "x" })).toBe(true);
  });
});
