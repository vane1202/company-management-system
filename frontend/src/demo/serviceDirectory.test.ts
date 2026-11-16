import { describe, expect, it } from "vitest";
import { fillHolder, type FillAccount } from "./serviceDirectory";
import type { EmployeeRecord, TenureRecord } from "./assessmentFoundation";

const account: FillAccount = { id: "registered-a", holderName: "虚构名册客服", registeredHolderId: "registered-person", wechatId: "WhatsApp · +999000000011", phoneLabel: null, teamId: "team", teamName: "秋菊组", isActive: true, createdAt: "" };
describe("登记账号试填归属", () => {
  it("今日显示当前负责人，不虚构员工号或历史任期", () => {
    expect(fillHolder(account, "2026-11-13", "2026-11-13", [], [])).toEqual({ id: "registered-person", name: "虚构名册客服", code: "" });
    expect(fillHolder(account, "2026-11-12", "2026-11-13", [], [])).toBeNull();
    expect(fillHolder(account, "2026-11-14", "2026-11-13", [], [])).toBeNull();
  });
  it("已有虚构账号仍根据原任期取人", () => {
    const legacy: FillAccount = { ...account, registeredHolderId: undefined };
    const employees: EmployeeRecord[] = [{ id: "old", name: "虚构前任", code: "DEMO-1", status: "left", teamId: "team" }];
    const tenures: TenureRecord[] = [{ id: "tenure", accountId: legacy.id, employeeId: "old", startDate: "2026-11-01", endDate: "2026-11-12" }];
    expect(fillHolder(legacy, "2026-11-12", "2026-11-13", employees, tenures)?.id).toBe("old");
  });
  it("交接按生效日期确定负责人，不把新员工倒填到旧任期", () => {
    const changed: FillAccount = { ...account, holderHistory: [{ employeeId: "old", name: "旧客服", startDate: "2026-11-01", endDate: "2026-11-14" }, { employeeId: "new", name: "新客服", startDate: "2026-11-15", endDate: null }] };
    expect(fillHolder(changed, "2026-11-14", "2026-11-15", [], [])?.id).toBe("old");
    expect(fillHolder(changed, "2026-11-15", "2026-11-15", [], [])?.id).toBe("new");
    expect(fillHolder(changed, "2026-10-30", "2026-11-15", [], [])).toBeNull();
  });
});
