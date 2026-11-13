import { describe, expect, it } from "vitest";
import { openingDays, orderDays, peopleRates, periodRate } from "./assessmentView";
import type { AssessmentAttendance, AssessmentLead } from "./assessmentFoundation";

const days = ["2026-11-07", "2026-11-09", "2026-11-13"];
const lead = (date: string, employeeId: string, contact: AssessmentLead["contact"], qualified = false): AssessmentLead => ({ id: date + employeeId + contact + qualified, accountId: "a", businessDate: date, employeeId, pageName: "主页", channel: "ms", contact, qualified, invalidReason: "" });
const room = (date: string, employeeId: string, entered: number, ordered: string[], link: "linked" | "unlinked"): AssessmentAttendance => ({ id: date + employeeId + link, accountId: "a", businessDate: date, employeeId, roomCode: "R", roomName: "一线", enteredCount: entered, orderedCustomerIds: ordered, orderLink: link, source: "测试" });

describe("客服考核口径", () => {
  it("开口转化率按人数合计，不平均每日百分比", () => {
    const leads = [
      lead("2026-11-07", "jia", "replied", true),
      lead("2026-11-07", "jia", "replied"),
      lead("2026-11-07", "jia", "replied"),
      lead("2026-11-07", "jia", "replied"),
      lead("2026-11-09", "former", "replied", true),
      lead("2026-11-09", "former", "replied"),
      lead("2026-11-09", "jia", "replied", true),
      lead("2026-11-09", "jia", "replied", true),
      lead("2026-11-09", "jia", "replied"),
      lead("2026-11-09", "jia", "replied"),
      lead("2026-11-09", "jia", "replied"),
      lead("2026-11-09", "jia", "invalid"),
      lead("2026-11-09", "jia", "read_no_reply"),
      lead("2026-11-13", "jia", "unread")
    ];
    const series = openingDays(leads, days);
    expect(series.map((day) => day.value)).toEqual(["25.0", "42.9", null]);
    expect(series[2].reason).toBe("正常沟通为0");
    expect(periodRate(series, "正常沟通为0")).toMatchObject({ part: 4, whole: 11, percent: "36.4%", fraction: "4/11人" });
  });

  it("未关联开单率不作0%，同一客户只算一人", () => {
    const attendance = [
      room("2026-11-07", "jia", 8, ["c1", "c1", "c2"], "linked"),
      room("2026-11-09", "jia", 10, ["c3"], "linked"),
      room("2026-11-09", "former", 12, ["c4", "c5", "c6"], "linked"),
      room("2026-11-13", "jia", 12, ["c9"], "unlinked")
    ];
    const series = orderDays(attendance, days);
    expect(series.map((day) => [day.value, day.reason, day.part, day.whole])).toEqual([
      ["25.0", "", 2, 8],
      ["18.2", "", 4, 22],
      [null, "尚未关联", 0, 0]
    ]);
    expect(periodRate(series, "未报")).toMatchObject({ percent: "20%", fraction: "6/30人", unlinked: 12 });
  });

  it("离任人员保留在各自日期，不并入新人", () => {
    const leads = [lead("2026-11-09", "former", "replied", true), lead("2026-11-09", "former", "replied"), lead("2026-11-13", "bing", "replied", true)];
    const rows = peopleRates(["former", "bing"], leads, [], days, "opening");
    expect(rows.map((row) => [row.employeeId, row.fraction])).toEqual([["former", "1/2人"], ["bing", "1/1人"]]);
  });
});