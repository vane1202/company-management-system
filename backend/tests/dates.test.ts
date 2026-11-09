import { describe, expect, it } from "vitest";
import {
  resolvePeriod,
  startOfMonth,
  startOfWeekMonday,
  toDateOnly
} from "../src/lib/dates.js";

describe("date-only 与周期", () => {
  it("字符串日期不会做时区换算", () => {
    expect(toDateOnly("2026-11-06")).toBe("2026-11-06");
    expect(toDateOnly("2026-11-01T00:00:00")).toBe("2026-11-01");
    expect(toDateOnly("2026-11-01T00:00:00.000Z")).toBe("2026-11-01");
  });

  it("本地午夜 Date 使用日历年月日，而不是 UTC ISO 切片", () => {
    const localMidnight = new Date(2026, 10, 1, 0, 0, 0);
    expect(toDateOnly(localMidnight)).toBe("2026-11-01");
  });

  it("本周从周一开始，本月从1日开始", () => {
    expect(startOfWeekMonday("2026-11-06")).toBe("2026-11-02");
    expect(startOfMonth("2026-11-06")).toBe("2026-11-01");
    expect(resolvePeriod("day", undefined, undefined, "2026-11-06")).toEqual({
      from: "2026-11-06",
      to: "2026-11-06"
    });
    expect(resolvePeriod("week", undefined, undefined, "2026-11-06")).toEqual({
      from: "2026-11-02",
      to: "2026-11-06"
    });
    expect(resolvePeriod("month", undefined, undefined, "2026-11-06")).toEqual({
      from: "2026-11-01",
      to: "2026-11-06"
    });
    expect(resolvePeriod("week", undefined, undefined, "2026-11-02")).toEqual({
      from: "2026-11-02",
      to: "2026-11-02"
    });
    expect(resolvePeriod("week", undefined, undefined, "2026-11-01")).toEqual({
      from: "2026-10-26",
      to: "2026-11-01"
    });
  });
});
