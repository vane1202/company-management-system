import { describe, expect, it } from "vitest";
import { previewCorrection, type HistoryRecord } from "./reportHistoryData";

const record: HistoryRecord = {
  id: "old-attendance", kind: "attendance", accountId: "fixed-account", accountLabel: "Messenger · account", teamName: "一组", businessDate: "2026-11-09", employeeName: "原客服", employeeCode: "CS-01", title: "一线", source: "直播间后台", version: 1,
  fields: [
    { key: "enteredCount", label: "实际入场人数", value: "12", type: "count", editable: true },
    { key: "orderedCount", label: "已关联开单人数", value: "3", type: "text", editable: false },
    { key: "note", label: "备注", value: "", type: "text", editable: true }
  ]
};
const correct = (values: Record<string, string>, reason = "后台人数录错", version = 1, role = "cs_supervisor") => previewCorrection(record, values, reason, version, role, "2026-11-13");

describe("历史更正预览", () => {
  it("主管更正保留原使用人、账号与业务日，不改写原始记录", () => {
    const original = JSON.stringify(record);
    const result = correct({ enteredCount: "15" });
    expect(result).toMatchObject({ record: { businessDate: "2026-11-09", employeeCode: "CS-01", accountId: "fixed-account", version: 2 } });
    if ("record" in result) expect(result.record.fields[0].value).toBe("15");
    expect(JSON.stringify(record)).toBe(original);
  });
  it("拒绝其他岗位、空原因、过期版本和修改锁定字段", () => {
    for (const role of ["cs", "boss", "admin", "finance", "ops"]) expect(correct({ enteredCount: "15" }, "修正", 1, role)).toHaveProperty("error");
    expect(correct({ enteredCount: "15" }, "  ")).toHaveProperty("error");
    expect(correct({ enteredCount: "15" }, "修正", 2)).toHaveProperty("error");
    for (const key of ["orderedCount", "employeeCode", "accountId", "businessDate", "settledAmount"]) expect(correct({ [key]: "任意内容" })).toHaveProperty("error");
  });
  it("人数必须为非负整数且不少于已关联开单人数", () => {
    for (const value of ["", "-1", "2.5", "2", "10000000"]) expect(correct({ enteredCount: value })).toHaveProperty("error");
    expect(correct({ enteredCount: "12" })).toHaveProperty("error");
  });
  it("金额不接受负数或过多小数，发货日期不接受不存在的日期", () => {
    const expense: HistoryRecord = { ...record, fields: [{ key: "cost", label: "成本", type: "money", editable: true, value: "400.00" }, { key: "shippedOn", label: "发货日期", type: "date", editable: true, value: "" }] };
    for (const value of ["-1", "1.001", "abc"]) expect(previewCorrection(expense, { cost: value }, "录错", 1, "cs_supervisor", "2026-11-13")).toHaveProperty("error");
    for (const date of ["2026-02-30", "2026-11-14"]) expect(previewCorrection(expense, { shippedOn: date }, "录错", 1, "cs_supervisor", "2026-11-13")).toHaveProperty("error");
  });
});
