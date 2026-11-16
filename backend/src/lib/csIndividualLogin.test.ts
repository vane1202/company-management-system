import { describe, expect, it } from "vitest";
import { assertCsProvisioningEnabled, csIndividualLoginEnabled, planCsLogins } from "./csIndividualLogin.js";

describe("客服个人登录预留", () => {
  it("默认不启用，只有明确 true 才允许准备账号", () => {
    expect(csIndividualLoginEnabled(undefined)).toBe(false);
    expect(csIndividualLoginEnabled("")).toBe(false);
    expect(csIndividualLoginEnabled("false")).toBe(false);
    expect(csIndividualLoginEnabled("true")).toBe(true);
    expect(() => csIndividualLoginEnabled("yes")).toThrow("只能为 true 或 false");
    expect(() => assertCsProvisioningEnabled(false)).toThrow("尚未启用");
  });

  it("用客服姓名生成停用账号计划，不创建账号", () => {
    const plans = planCsLogins([
      { id: "person-ronghui", name: "荣慧" },
      { id: "person-left", name: "已离职", status: "left" }
    ]);
    expect(plans.find(plan => plan.personRef === "person-ronghui")).toMatchObject({ username: "荣慧", action: "create_disabled", mustChangePassword: true });
    expect(plans.find(plan => plan.personRef === "person-left")).toMatchObject({ username: null, action: "skip_inactive" });
  });
});
