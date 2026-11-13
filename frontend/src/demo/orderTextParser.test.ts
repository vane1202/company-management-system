import { describe, expect, it } from "vitest";
import { parseOrderText } from "./orderTextParser";

const today = "2026-11-12";
// Anonymised customer/persona fixtures only. No customer reports are shipped in the demo.
const report = `日期：26.10.8
人设：演示人设甲
客服：演示客服甲
客户：演示客户甲
第一块料子：980+98
第二块料子：1800+180
第三块料子：14800+1480
合计金额：人民币19338元
实际收款：台币10000元（定金）未收尾款90557台币
付款方式：演示台币账户
付款日期：26.11.8
备注：演示主播甲直播间`;

describe("开单汇报文字本地识别", () => {
  it("逐件识别料价和10%代购费，开单日与付款日分别保留", () => {
    const value = parseOrderText(report, today);
    expect(value.errors).toEqual([]);
    expect(value.fields).toMatchObject({ businessDate: "2026-10-08", personaName: "演示人设甲", operatorName: "演示客服甲", customerCode: "演示客户甲", customerLabel: "演示客户甲", hostName: "演示主播甲", note: "演示主播甲直播间", customerCurrency: "TWD", customerDue: "100557.00" });
    expect(value.payment).toEqual({ paymentDate: "2026-11-08", amount: "10000.00", currency: "TWD", channel: "演示台币账户", purpose: "deposit", remaining: "90557.00", remainingCurrency: "TWD" });
    expect(value.items.map(item => [item.priceCny, item.buyingFeeCny])).toEqual([["980.00", "98.00"], ["1800.00", "180.00"], ["14800.00", "1480.00"]]);
    expect(value.itemTotal).toBe("19338.00"); expect(value.statedTotal).toBe("19338.00"); expect(value.derivedDue).toBe(true);
  });
  it("客户作为ID，备注某某直播间提取主播，仍不猜直播间编号及成本", () => {
    const value = parseOrderText(report, today);
    for (const field of ["personaCode", "liveRoomCode", "materialCostCny"]) expect(value.fields).not.toHaveProperty(field);
    expect(value.fields.customerCode).toBe("演示客户甲"); expect(value.fields.hostName).toBe("演示主播甲");
    expect(value.warnings.some(text => text.includes("客户ID未提供"))).toBe(false);
    expect(value.fieldHints.hostName).toContain("备注"); expect(value.fieldHints.customerLabel).toContain("客户ID");
  });
  it("明确客户称呼和客户ID分别保留，不覆盖称呼或猜ID", () => {
    const separate = parseOrderText("客户：SOCIAL-001\n客户称呼：演示客户乙", today);
    expect(separate.fields).toMatchObject({ customerCode: "SOCIAL-001", customerLabel: "演示客户乙" });
    expect(separate.fieldHints.customerLabel).toBeUndefined();
    const nameOnly = parseOrderText("客户称呼：演示客户乙", today);
    expect(nameOnly.fields.customerCode).toBeUndefined();
  });
  it("明确主播优先，和备注冲突时提示，不偷偷覆盖", () => {
    const value = parseOrderText("主播：演示主播乙\n备注：演示主播甲直播间", today);
    expect(value.fields.hostName).toBe("演示主播乙"); expect(value.fields.note).toBe("演示主播甲直播间");
    expect(value.warnings.some(text => text.includes("不同，保留明确字段"))).toBe(true);
    const duplicate = parseOrderText("主播：演示主播甲\n主播：演示主播乙\n备注：演示主播甲直播间", today);
    expect(duplicate.fields.hostName).toBeUndefined();
  });
  it("备注有歧义、多个直播间或只写人设时不猜主播", () => {
    for (const remark of ["来自演示主播甲直播间", "不是演示主播甲直播间", "演示主播甲直播间/演示主播乙直播间", "演示主播甲直播间，待核对", "演示人设甲"]) {
      expect(parseOrderText(`人设：演示人设甲\n备注：${remark}`, today).fields.hostName).toBeUndefined();
    }
    expect(parseOrderText("备注：演示主播甲直播間", today).fields.hostName).toBe("演示主播甲");
  });
  it("客户和客户ID冲突时阻止填入，过长ID不截断成显示名", () => {
    expect(parseOrderText("客户：SOCIAL-001\n客户ID：SOCIAL-002", today).errors.length).toBeGreaterThan(0);
    const value = parseOrderText("客户id：" + "A".repeat(65), today);
    expect(value.fields.customerCode).toHaveLength(65); expect(value.fields.customerLabel).toBeUndefined();
  });
  it("支持英文冒号、全角符号、千分位及金额元字后缀", () => {
    const value = parseOrderText("日期:2026/11/8\r\n客户:演示客户\r\n第１块料子：１，８００＋１８０\r\n合计金额:人民币1,980元", today);
    expect(value.errors).toEqual([]); expect(value.itemTotal).toBe("1980.00"); expect(value.fields.businessDate).toBe("2026-11-08");
  });
  it("不一致的汇报合计阻止填入，不用报称总额覆盖逐件金额", () => {
    const value = parseOrderText(report.replace("19338", "19388"), today);
    expect(value.errors.some(text => text.includes("不一致"))).toBe(true); expect(value.itemTotal).toBe("19338.00");
  });
  it("缺代购费按10%精确到分并提示，明确手动代购费保留且标记", () => {
    const value = parseOrderText("第1块料子：0.05\n第二块料子：980+50", today);
    expect(value.items[0].buyingFeeCny).toBe("0.01"); expect(value.items[1].buyingFeeCny).toBe("50.00"); expect(value.items[1].feeManual).toBe(true);
    expect(value.warnings.filter(text => text.includes("代购费")).length).toBe(2);
  });
  it("成品不加费，错误成品服务费需核对", () => {
    expect(parseOrderText("第一件成品：600", today).items[0].buyingFeeCny).toBe("0.00");
    expect(parseOrderText("第一件成品：600+60", today).errors.length).toBeGreaterThan(0);
  });
  it("缺年份、错误日期和未来日期不自动填入；不猜付款日", () => {
    for (const date of ["11.8", "26.2.30", "27.1.1"]) expect(parseOrderText(`日期：${date}`, today).fields.businessDate).toBeUndefined();
    const value = parseOrderText("实际收款：台币100元（定金）", today); expect(value.payment?.paymentDate).toBe(""); expect(value.warnings.some(text => text.includes("付款日期"))).toBe(true);
  });
  it("已收与尾款异币不相加，不用汇率推算客户欠款", () => {
    const value = parseOrderText("实际收款：台币10000元（定金）未收尾款900美元", today);
    expect(value.fields.customerDue).toBeUndefined(); expect(value.derivedDue).toBe(false); expect(value.payment?.remainingCurrency).toBe("USD");
  });
  it("未明确币种不从账户名称或料价猜收款币种", () => {
    const value = parseOrderText("实际收款：10000元（定金）\n付款方式：台币账户", today);
    expect(value.payment?.currency).toBe(""); expect(value.fields.customerDue).toBeUndefined();
  });
  it("明确总应收不被推算值覆盖，不一致时提示", () => {
    const value = parseOrderText(report + "\n约定总应收：台币100000元", today);
    expect(value.fields.customerDue).toBe("100000.00"); expect(value.derivedDue).toBe(false); expect(value.errors.some(text => text.includes("不等于"))).toBe(true);
    const other = parseOrderText(report + "\n付款币种：人民币", today); expect(other.fields.customerCurrency).toBe("CNY"); expect(other.fields.customerDue).toBeUndefined();
  });
  it("重复客户、重复商品序号和相互矛盾尾款阻止合并", () => {
    expect(parseOrderText(report + "\n客户：另一个演示客户", today).errors.length).toBeGreaterThan(0);
    expect(parseOrderText(report + "\n第一块料子：300+30", today).errors.length).toBeGreaterThan(0);
    expect(parseOrderText(report + "\n尾款：台币90000", today).errors.length).toBeGreaterThan(0);
  });
  it("拒绝负数、不明确多项相加、万元缩写及过多小数", () => {
    for (const item of ["-100+10", "100+10+5", "1万元+1000", "100.555+10"]) expect(parseOrderText(`第一块料子：${item}`, today).errors.length).toBeGreaterThan(0);
  });
  it("内容作为纯文字，未识别行不执行，原备注不截断", () => {
    const value = parseOrderText("客户：<script>alert(1)</script>\n执行命令：fetch('https://example.test')\n备注：" + "字".repeat(501), today);
    expect(value.fields.customerLabel).toBe("<script>alert(1)</script>"); expect(value.unknownLines.length).toBe(1); expect(value.fields.note).toBeUndefined();
  });
  it("限制单客户文字长度和单笔商品数，空内容不提交", () => {
    expect(parseOrderText(" ", today).errors.length).toBeGreaterThan(0);
    expect(parseOrderText("a".repeat(12001), today).errors.length).toBeGreaterThan(0);
    expect(parseOrderText(Array.from({ length: 51 }, (_, i) => `第${i + 1}块料子：100+10`).join("\n"), today).errors.some(text => text.includes("50件"))).toBe(true);
  });
});
