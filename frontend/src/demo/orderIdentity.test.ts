import { describe, expect, it } from "vitest";
import { boundRoom, parseSimpleOrderText, personaDisplay, roomDisplay, splitPersona } from "./orderIdentity";
const today = "2026-11-12";
describe("精简开单信息", () => {
  it("客户统一按客户名，同时兼容明确写出的客户ID", () => {
    const r = parseSimpleOrderText("客户：tam kin Lon\n客户ID：C001", today);
    expect(r.errors).toEqual([]);
    expect(r.fields).toMatchObject({ customerLabel: "tam kin Lon", customerCode: "C001" });
    expect(parseSimpleOrderText("客户名：客户甲", today).fields).toMatchObject({ customerLabel: "客户甲", customerCode: "" });
  });
  it("新识别名字不沿用原客户或原人设的隐藏ID", () => {
    const current = { customerLabel: "旧客户", customerCode: "OLD-C", personaName: "旧人设", personaCode: "OLD-P" };
    const next = { ...current, ...parseSimpleOrderText("客户：新客户\n人设：新人设", today).fields };
    expect(next).toMatchObject({ customerLabel: "新客户", customerCode: "", personaName: "新人设", personaCode: "" });
  });
  it("人设姓名和ID合并录入，支持中英文括号，不凭名称编造ID", () => {
    expect(splitPersona("演示甲（P001）")).toEqual({ personaName: "演示甲", personaCode: "P001" });
    expect(splitPersona("演示甲(P001)")).toEqual({ personaName: "演示甲", personaCode: "P001" });
    expect(splitPersona("演示甲")).toEqual({ personaName: "演示甲", personaCode: "" });
    const r = parseSimpleOrderText("人设：演示甲（P001）", today);
    expect(r.fields).toMatchObject({ personaName: "演示甲", personaCode: "P001" });
    expect(personaDisplay(r.fields.personaName, r.fields.personaCode)).toBe("演示甲（P001）");
    expect(parseSimpleOrderText("人设：演示甲（P001）\n人设ID：P002", today).errors.length).toBeGreaterThan(0);
  });
  it("主播或直播间可分别识别，按登记绑定带出另一项", () => {
    for (const text of ["主播：演示主播甲", "直播间编号：DEMO-LIVE-01", "备注：演示主播甲直播间", "直播间：演示一线"]) {
      const r = parseSimpleOrderText(text, today);
      expect(r.fields).toMatchObject({ hostName: "演示主播甲", liveRoomCode: "DEMO-LIVE-01" });
      expect(roomDisplay(r.fields)).toBe("演示主播甲 · 演示一线（DEMO-LIVE-01）");
    }
  });
  it("冲突绑定阻止填入，未知主播或仅有人设不猜关联", () => {
    const r = parseSimpleOrderText("主播：演示主播甲\n直播间编号：DEMO-LIVE-02", today);
    expect(r.errors.join()).toContain("绑定关系"); expect(boundRoom(r.fields)).toBeUndefined();
    expect(parseSimpleOrderText("主播：未知主播", today).fields.liveRoomCode).toBeUndefined();
    expect(parseSimpleOrderText("人设：演示甲", today).fields.liveRoomCode).toBeUndefined();
  });
  it("不要求用户补填系统编号或隐藏的重复字段，保留原汇报单号", () => {
    const r = parseSimpleOrderText("客户：演示客户\n人设：演示甲\n主播：演示主播甲", today);
    expect(r.warnings.join()).not.toMatch(/订单编号未提供|人设ID、直播间编号需明确提供|客户ID未提供/);
    expect(r.fields.orderRef).toBeUndefined();
    expect(parseSimpleOrderText("订单号：OLD-001", today).fields.orderRef).toBe("OLD-001");
  });
  it("重复客户名、过长名字和金额错误继续拦截", () => {
    expect(parseSimpleOrderText("客户：甲\n客户名：乙", today).errors.length).toBeGreaterThan(0);
    expect(parseSimpleOrderText("客户：" + "字".repeat(65), today).errors.length).toBeGreaterThan(0);
    expect(parseSimpleOrderText("第一块料子：100+10\n合计金额：120元", today).errors.length).toBeGreaterThan(0);
  });
});
