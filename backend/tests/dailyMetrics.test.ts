import { describe, expect, it } from "vitest";
import {
  FAN_STATS_INCOMPLETE_NOTE,
  fanRowIsLegacyUnclassified,
  fanTodayIncrement,
  lastMonthCumulative,
  lastMoneySnapshotsThenSum,
  lastSnapshotsThenSum,
  summarizeFanRows
} from "../src/lib/dailyMetrics.js";

describe("dailyMetrics helpers", () => {
  it("sums latest USD balances exactly without summing days", () => {
    expect(lastMoneySnapshotsThenSum([
      { user_id: "u1", persona_name: "A", business_date: "2026-11-01", value: "999.99" },
      { user_id: "u1", persona_name: "A", business_date: "2026-11-02", value: "0.10" },
      { user_id: "u1", persona_name: "B", business_date: "2026-11-02", value: "0.20" }
    ])).toBe("0.30");
  });
  it("treats old added_count-only rows as unclassified legacy", () => {
    const row = { user_id: "u1", business_date: "2026-11-01", page_name: "", added_count: 15 };
    expect(fanRowIsLegacyUnclassified(row)).toBe(true);
    expect(fanTodayIncrement(row)).toBe(15);
  });

  it("uses Ms+Ws today increments for detailed rows and does not invent channels from added_count", () => {
    const row = {
      user_id: "u1",
      business_date: "2026-11-08",
      page_name: "雪儿主页",
      added_count: 0,
      ms_today: 3,
      ws_today: 2,
      ms_month: 40,
      ws_month: 21
    };
    expect(fanRowIsLegacyUnclassified(row)).toBe(false);
    expect(fanTodayIncrement(row)).toBe(5);
  });

  it("keeps unclassified old counts separate and marks stats incomplete", () => {
    const summary = summarizeFanRows([
      { user_id: "u1", business_date: "2026-11-08", page_name: "", added_count: 15 },
      {
        user_id: "u1",
        business_date: "2026-11-08",
        page_name: "雪儿主页",
        added_count: 0,
        ms_today: 3,
        ws_today: 1,
        valid_today: 2,
        comm_replied: 1,
        comm_read_no_reply: 1,
        comm_unread: 1,
        comm_invalid: 1
      }
    ]);
    expect(summary.legacyUnclassifiedAdded).toBe(15);
    expect(summary.msToday).toBe(3);
    expect(summary.wsToday).toBe(1);
    expect(summary.todayTotal).toBe(19);
    expect(summary.statsIncomplete).toBe(true);
    expect(summary.note).toBe(FAN_STATS_INCOMPLETE_NOTE);
    expect(summary.validToday).toBe(2);
    expect(summary.commReplied + summary.commReadNoReply + summary.commUnread + summary.commInvalid).toBe(4);
  });

  it("takes the last month-to-date per user+page instead of summing daily MTD figures", () => {
    const rows = [
      { user_id: "u1", business_date: "2026-11-01", page_name: "A", ms_month: 10, ws_month: 4, ms_today: 10, ws_today: 4 },
      { user_id: "u1", business_date: "2026-11-08", page_name: "A", ms_month: 40, ws_month: 21, ms_today: 3, ws_today: 2 },
      { user_id: "u1", business_date: "2026-11-08", page_name: "B", ms_month: 5, ws_month: 1, ms_today: 1, ws_today: 0 }
    ];
    expect(lastMonthCumulative(rows, "ms_month")).toBe(45);
    expect(lastMonthCumulative(rows, "ws_month")).toBe(22);
  });

  it("does not invent a month opening from legacy added_count", () => {
    const rows = [
      { user_id: "u1", business_date: "2026-10-30", page_name: "", added_count: 99 },
      { user_id: "u1", business_date: "2026-11-08", page_name: "A", ms_month: 12, ws_month: 3, ms_today: 1, ws_today: 1 }
    ];
    expect(lastMonthCumulative(rows, "ms_month")).toBe(12);
  });

  it("sums last inventory snapshots per persona and never sums the same persona across days", () => {
    const total = lastSnapshotsThenSum([
      { user_id: "e1", persona_name: "雪儿", business_date: "2026-11-01", value: 10 },
      { user_id: "e1", persona_name: "雪儿", business_date: "2026-11-08", value: 6 },
      { user_id: "e1", persona_name: "文强", business_date: "2026-11-07", value: 4 }
    ]);
    expect(total).toBe(10);
  });
});
