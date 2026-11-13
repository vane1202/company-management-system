import { describe, expect, it } from "vitest";
import { afterSaleTotals, parseAfterSaleText, signedMoney } from "./afterSalesText";
import { parseFanText } from "./fanText";
const today = "2026-11-12";
const after = "人设：糖糖合作\n客服：阿杰\n客户：tam kin Lon\n卖价：600人民币\n实收：600人民币\n付款方式：支付宝账户\n付款日期：26.11.5\n备注：直播间\n发货日期：26.11.6\n关公：400人民币\n证书支出：6元\n盒子支出：9元\n运费支出：30元\n合计：445元";
describe("售后日报识别", () => {
  it("分别识别客户应收、实收、成本合计和发货；不把合计重复录入", () => {
    const r = parseAfterSaleText(after, today);
    expect(r.errors).toEqual([]);
    expect(r.fields).toMatchObject({ customerCode: "tam kin Lon", chargeCny: "600.00", paidAmount: "600.00", paidCurrency: "CNY", channel: "支付宝账户", paymentDate: "2026-11-05", shippedOn: "2026-11-06", note: "直播间" });
    expect(r.expenses).toHaveLength(4);
    expect(r.expenses.map(e => e.category)).toEqual(["", "certificate", "box", "shipping"]);
    expect(afterSaleTotals(r.fields, r.expenses)).toEqual({ cost: 44500n, difference: 15500n });
    expect(r.fields.businessDate).toBeUndefined();
    expect(r.fields.chargeLabel).toBeUndefined();
    expect(r.fields.hostName).toBeUndefined();
  });
  it("合计不符阻止填入，不用总数覆盖费用明细", () => {
    const r = parseAfterSaleText(after.replace("445元", "400元"), today);
    expect(r.errors.join()).toContain("合计不一致");
    expect(afterSaleTotals(r.fields, r.expenses).cost).toBe(44500n);
  });
  it("外币实收保持原币，不生成公司到账或汇率抵扣", () => {
    const r = parseAfterSaleText(after.replace("实收：600人民币", "实收：2800台币"), today);
    expect(r.fields).toMatchObject({ paidAmount: "2800.00", paidCurrency: "TWD", chargeCny: "600.00" });
    expect(afterSaleTotals(r.fields, r.expenses).difference).toBe(15500n);
  });
  it("重复收款／客户、负数、超精度、未知币种不能静默通过", () => {
    expect(parseAfterSaleText(after + "\n实收：1人民币", today).errors.length).toBeGreaterThan(0);
    expect(parseAfterSaleText(after + "\n客户：其他客户", today).errors.length).toBeGreaterThan(0);
    expect(parseAfterSaleText(after.replace("600人民币", "-600人民币"), today).errors.length).toBeGreaterThan(0);
    expect(parseAfterSaleText(after.replace("600人民币", "600.123人民币"), today).errors.length).toBeGreaterThan(0);
    expect(parseAfterSaleText(after.replace("400人民币", "400美元"), today).errors.length).toBeGreaterThan(0);
  });
  it("无币种数字不默认人民币；无效日期不填今天", () => {
    const r = parseAfterSaleText(after.replace("实收：600人民币", "实收：600").replace("26.11.5", "26.2.30"), today);
    expect(r.fields.paidCurrency).toBe(""); expect(r.fields.paymentDate).toBeUndefined();
  });
  it("未知文字保留；成本大于收费显示负差额；成本未录入不当零", () => {
    const r = parseAfterSaleText(after.replace("卖价：600人民币", "卖价：300人民币") + "\n请照原文处理", today);
    expect(r.unknownLines).toContain("请照原文处理");
    expect(signedMoney(afterSaleTotals(r.fields, r.expenses).difference!)).toBe("-145.00");
    expect(afterSaleTotals(r.fields, []).difference).toBeNull();
  });
  it("保留显式订单与主播身份，不按人设名称构造直播间关联", () => {
    const r = parseAfterSaleText(after + "\n订单编号：SO-1\n人设ID：P1\n主播：演示主播\n直播间编号：L1", today);
    expect(r.fields).toMatchObject({ orderRef: "SO-1", personaCode: "P1", hostName: "演示主播", liveRoomCode: "L1" });
  });
});
const fans = "客服：廖始航（6149）\n日期：26.11.8\n主页(全名)：南詔工匠 小雪\n本月Ms进粉总数：40\n本月Ws进粉人数：12\n今日Ms进粉总数：5\n1  Sheree Chen 已读不回\n2  Loh Kenny  马来西亚人，喜欢翡翠，想了解\n3  Winson Lin  4000台币白冰手镯，报价2000人民币，吓到拉黑了\n4  鐘浚銘  已读不回\n5  洪豆冰  点广告进来两次都不回复\n今日Ws进粉人数：0\n今日有效：4\n正常沟通回复：2\n已读不回：6\n未读：28\n无效粉：16";
describe("每日加粉日报识别", () => {
  it("本月累计和当日沟通分开；不要求沟通合计等于进粉", () => {
    const r = parseFanText(fans, today);
    expect(r.errors).toEqual([]);
    expect(r.fields).toMatchObject({ businessDate: "2026-11-08", msMonth: "40", wsMonth: "12", msToday: "5", wsToday: "0", commReadNoReply: "6", commUnread: "28", commInvalid: "16" });
    expect(r.leads.map(l => l.customer)).toEqual(["Sheree Chen", "Loh Kenny", "Winson Lin", "鐘浚銘", "洪豆冰"]);
    expect(r.leads.every(l => l.channel === "ms" && !l.qualified)).toBe(true);
    expect(r.unknownLines).toEqual([]);
  });
  it("不同渠道分别归类，不用姓名或日报文字切换所选接待账号", () => {
    const r = parseFanText(fans.replace("今日Ws进粉人数：0", "今日Ws进粉人数：1\n1 陈先生 想咨询戒指"), today);
    expect(r.leads.at(-1)).toMatchObject({ customer: "陈先生", channel: "ws", qualified: false });
    expect(Object.keys(r.fields)).not.toContain("accountId");
  });
  it("缺年份日期不猜今天；客户名单不全保留警示", () => {
    const r = parseFanText(fans.replace("26.11.8", "11.8").replace("总数：5", "总数：9"), today);
    expect(r.fields.businessDate).toBeUndefined();
    expect(r.warnings.join()).toContain("条数与今日进粉数不同");
  });
  it("重复字段、负数或重复客户阻止填入", () => {
    expect(parseFanText(fans + "\n今日有效：4", today).errors.length).toBeGreaterThan(0);
    expect(parseFanText(fans.replace("今日有效：4", "今日有效：-4"), today).errors.length).toBeGreaterThan(0);
    expect(parseFanText(fans.replace("Loh Kenny", "Sheree Chen"), today).errors.length).toBeGreaterThan(0);
  });
  it("单份日报限制长度，不执行原文内容", () => {
    expect(parseFanText("x".repeat(12001), today).errors.length).toBeGreaterThan(0);
    const r = parseFanText(fans + "\n<script>alert(1)</script>", today);
    expect(r.unknownLines).toContain("<script>alert(1)</script>");
  });
});
