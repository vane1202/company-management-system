import { describe, expect, it } from "vitest";
import { centsToYuan, createSeed, customerStatus, customerTags, ensureTeamSamples, normalizeCrmState, officialInvalidCustomers, personalPerformance, reduceCrm, type CrmActor } from "./customerCrm";

const today = "2026-11-14";
const cs: CrmActor = { role: "cs", employeeId: "demo-cs-a", employeeName: "演示客服甲", teamIds: ["demo-team-a"] };
const supervisor: CrmActor = { role: "cs_supervisor", employeeId: "demo-supervisor", employeeName: "演示客服主管", teamIds: ["demo-team-a", "registered-team-qiuju"] };

describe("客资标签与无效复核", () => {
  it("待复核仍算有效，确认后才进入无效池，退回和恢复不删除订单", () => {
    const seed = createSeed(today);
    const pending = seed.customers.find(customer => customer.name.includes("待复核"))!;
    expect(customerStatus(seed, pending)).toBe("valid");
    expect(customerTags(seed, pending)).toContain("待复核");
    expect(officialInvalidCustomers(seed).map(customer => customer.id)).not.toContain(pending.id);
    const approved = reduceCrm(seed, { type: "reviewInvalid", actor: supervisor, reviewId: "sample-r1", decision: "approve", note: "" }, today);
    expect(customerStatus(approved, pending)).toBe("invalid");
    expect(officialInvalidCustomers(approved).some(customer => customer.id === pending.id)).toBe(true);
    const rejected = reduceCrm(seed, { type: "reviewInvalid", actor: supervisor, reviewId: "sample-r1", decision: "reject", note: "仍可继续聊需求" }, today);
    expect(customerStatus(rejected, pending)).toBe("valid");
    expect(rejected.orders).toHaveLength(seed.orders.length);
    const restored = reduceCrm(seed, { type: "reviewInvalid", actor: supervisor, reviewId: "sample-r2", decision: "restore", note: "客户后来可以用中文沟通" }, today);
    const invalid = seed.customers.find(customer => customer.id === "sample-invalid")!;
    expect(customerStatus(restored, invalid)).toBe("dealt");
    expect(restored.orders.some(order => order.customerId === invalid.id)).toBe(true);
  });

  it("有效订单超过两笔才标复购，跑单和售后都不增加订单数", () => {
    const seed = createSeed(today);
    const repeat = seed.customers.find(customer => customer.id === "sample-repeat")!;
    expect(customerTags(seed, repeat)).toEqual(["已成交", "A档", "复购"]);
    const dealt = seed.customers.find(customer => customer.id === "sample-dealt")!;
    expect(customerTags(seed, dealt)).not.toContain("复购");
  });

  it("个人业绩按经办客服保留，私推只计料价，跑单回冲", () => {
    const seed = createSeed(today);
    const result = personalPerformance(seed, "demo-cs-a");
    expect(centsToYuan(result.liveCents)).toBe("5478.00");
    expect(result.liveCount).toBe(5);
    expect(centsToYuan(result.privateCents)).toBe("600.00");
    expect(result.privateCount).toBe(1);
    expect(centsToYuan(result.totalCents)).toBe("6078.00");
    const moved = { ...seed, customers: seed.customers.map(customer => customer.id === "sample-private" ? { ...customer, employeeId: "other", employeeName: "后来的客服" } : customer) };
    expect(personalPerformance(moved, "demo-cs-a").privateCount).toBe(1);
    expect(personalPerformance(moved, "other").privateCount).toBe(0);
  });

  it("客服提交无效申请不直接改状态，主管以外不能复核", () => {
    const seed = createSeed(today);
    const target = seed.customers.find(customer => customer.id === "sample-valid")!;
    const requested = reduceCrm(seed, { type: "requestInvalid", actor: cs, customerId: target.id, reason: "obscene", note: "聊天内容不适" }, today);
    expect(customerStatus(requested, target)).toBe("valid");
    expect(() => reduceCrm(requested, { type: "reviewInvalid", actor: cs, reviewId: requested.reviews.at(-1)!.id, decision: "approve", note: "" }, today)).toThrow("只有客服主管");
    expect(() => reduceCrm(seed, { type: "addOrder", actor: cs, customerId: target.id, businessDate: today, channel: "private", materialCny: "980", feeCny: "98" }, today)).toThrow("不收代购费");
  });

  it("真实名册只补充一次演练样本", () => {
    const once = ensureTeamSamples(createSeed(today), today, { teamId: "registered-team-qiuju", teamName: "秋菊组", personId: "registered-ronghui", personName: "荣慧", accountId: "registered-wa" });
    const twice = ensureTeamSamples(once, today, { teamId: "registered-team-qiuju", teamName: "秋菊组", personId: "registered-ronghui", personName: "荣慧", accountId: "registered-wa" });
    expect(twice).toBe(once);
    expect(once.customers.filter(customer => customer.employeeName === "荣慧")).toHaveLength(6);
  });
});

describe("下粉广告户ID", () => {
  it("新客户保留登记当时的文本，旧档案没有该字段时显示来源待补", () => {
    const seed = createSeed(today);
    expect(seed.customers.every(customer => customer.adAccountId === "")).toBe(true);
    const saved = reduceCrm(seed, { type: "registerLeads", leads: [{ name: "新客户", accountId: "demo-account-a", employeeId: "demo-cs-a", employeeName: "演示客服甲", teamId: "demo-team-a", teamName: "演示一组", source: "演示主页", adAccountId: "01871", createdOn: today, need: "手镯", contact: "replied", invalidReason: "", invalidNote: "" }] }, today);
    expect(saved.customers.at(-1)?.adAccountId).toBe("01871");
    const legacy = normalizeCrmState({ ...seed, customers: seed.customers.map(customer => { const { adAccountId: _removed, ...rest } = customer; return rest as typeof customer; }) });
    expect(legacy.customers[0].adAccountId).toBe("");
    expect(() => reduceCrm(seed, { type: "registerLeads", leads: [{ name: "坏编号", accountId: "demo-account-a", employeeId: "demo-cs-a", employeeName: "演示客服甲", teamId: "demo-team-a", teamName: "演示一组", source: "演示主页", adAccountId: "18.71", createdOn: today, need: "", contact: "", invalidReason: "", invalidNote: "" }] }, today)).toThrow(/数字/);
  });
});
