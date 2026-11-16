import { describe, expect, it } from "vitest";
import { assertOpsProvisioningEnabled, hashOpsInitialPassword, planOpsLogins } from "./opsIndividualLogin.js";
import { verifyPassword } from "./password.js";
describe("运营账号准备", () => {
  it("四人稳定绑定，默认准备停用账号并要求首次改密", () => {
    const plans = planOpsLogins();
    expect(plans.map(row => row.displayName)).toEqual(["子恒", "小蒲", "代运营A", "代运营B"]);
    expect(plans.map(row => row.username)).toEqual(["子恒", "小蒲", "代运营a", "代运营b"]);
    expect(plans.every(row => row.action === "create_disabled" && row.mustChangePassword)).toBe(true);
    expect(() => assertOpsProvisioningEnabled()).toThrow();
    expect(() => assertOpsProvisioningEnabled("true")).not.toThrow();
  });
  it("保留已关联账号，不自动覆盖同名或其他岗位的账号", () => {
    const existing = { id: "u", username: "custom_ops", opsPersonRef: "ops-ziheng", role: "ops", accountKind: "employee" };
    expect(planOpsLogins([existing])[0].action).toBe("keep_existing");
    expect(() => planOpsLogins([{ ...existing, opsPersonRef: null, username: "子恒" }])).toThrow();
    expect(() => planOpsLogins([{ ...existing, role: "finance" }])).toThrow();
  });
  it("初始密码仅在服务端哈希，不能明文入库", async () => {
    const hash = await hashOpsInitialPassword();
    expect(hash).not.toBe("nanzhaoarts");
    expect(await verifyPassword("nanzhaoarts", hash)).toBe(true);
    expect(await verifyPassword("incorrect", hash)).toBe(false);
  });
});
