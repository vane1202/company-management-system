import type { Currency } from "../api";
import { cents } from "../commerceUi";
import { amountIn, dateIn, parseOrderText, type OrderTextFields } from "./orderTextParser";

export type AfterSaleExpense = { label: string; category: string; amountCny: string; counterparty: string };
export type AfterSaleFields = {
  orderRef: string; customerCode: string; personaName: string; personaCode: string;
  liveRoomCode: string; hostName: string; operatorName: string; note: string;
  chargeLabel: string; chargeCny: string; paidAmount: string; paidCurrency: Currency | "";
  channel: string; paymentDate: string; shippedOn: string; businessDate: string;
};
export const emptyAfterSale = (): AfterSaleFields => ({ orderRef: "", customerCode: "", personaName: "", personaCode: "", liveRoomCode: "", hostName: "", operatorName: "", note: "", chargeLabel: "", chargeCny: "", paidAmount: "", paidCurrency: "", channel: "", paymentDate: "", shippedOn: "", businessDate: "" });
export type AfterSaleText = { fields: Partial<AfterSaleFields>; expenses: AfterSaleExpense[]; statedCost: string | null; errors: string[]; warnings: string[]; unknownLines: string[] };
const metadataKeys = /^(?:订单编号|订单号|开单编号|客户|客户ID|客户编号|人设|主页|人设ID|人设编号|客服|经办客服|经办客服姓名|直播间编号|直播间ID|主播|对应主播|备注)$/;
const categoryFor = (name: string) => /证书|证书支出/.test(name) ? "certificate" : /盒子|包装/.test(name) ? "box" : /运费|邮费|快递/.test(name) ? "shipping" : /配件/.test(name) ? "accessory" : /配货|采购/.test(name) ? "sourcing" : /设计|雕刻/.test(name) ? "design" : /加工|工费/.test(name) ? "labor" : "";
export function signedMoney(value: bigint) { const n = value < 0n ? -value : value; return `${value < 0n ? "-" : ""}${n / 100n}.${String(n % 100n).padStart(2, "0")}`; }
export function afterSaleTotals(fields: Partial<AfterSaleFields>, expenses: AfterSaleExpense[]) {
  const amounts = expenses.map(e => cents(e.amountCny));
  const cost = expenses.length && amounts.every(n => n !== null) ? amounts.reduce<bigint>((s, n) => s + n!, 0n) : null;
  const charge = fields.chargeCny ? cents(fields.chargeCny) : null;
  return { cost, difference: cost !== null && charge !== null ? charge - cost : null };
}

/** Local report extraction only. A cost line never becomes a customer charge or a supplier payment. */
export function parseAfterSaleText(text: string, today: string): AfterSaleText {
  const result: AfterSaleText = { fields: {}, expenses: [], statedCost: null, errors: [], warnings: [], unknownLines: [] };
  if (!text.trim() || text.length > 12000) { result.errors.push("请粘贴一位客户的一笔售后汇报，最多12000字。"); return result; }
  const metadata: string[] = [], seen = new Map<string, string>();
  const aliases: Record<string, string> = { "卖价": "chargeCny", "售价": "chargeCny", "客户收费": "chargeCny", "追加应收": "chargeCny", "实收": "paidAmount", "实际收款": "paidAmount", "付款方式": "channel", "收款账户": "channel", "付款日期": "paymentDate", "收款日期": "paymentDate", "发货日期": "shippedOn", "日期": "businessDate", "费用日期": "businessDate", "收费名称": "chargeLabel", "售后项目": "chargeLabel", "合计": "statedCost", "成本合计": "statedCost", "支出合计": "statedCost" };
  for (const source of text.split(/\r\n?|\n/)) {
    const line = source.normalize("NFKC").replace(/\\\s*$/, "").trim();
    if (!line) continue;
    const match = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(line);
    if (!match) { result.unknownLines.push(line); continue; }
    const label = match[1].trim(), key = label.replace(/\s/g, "").replace(/id$/i, "ID"), value = match[2].trim();
    if (metadataKeys.test(key)) { metadata.push(`${key}：${value}`); continue; }
    const field = aliases[key];
    const canonical = field || `expense:${key}`;
    if (seen.has(canonical)) { result.errors.push(`「${label}」重复出现，请合并或拆分后重新识别。`); continue; }
    seen.set(canonical, value);
    if (field === "channel" || field === "chargeLabel") {
      if (value.length > 128) result.errors.push(`「${label}」超出128字。`);
      else result.fields[field] = value;
    } else if (field === "businessDate" || field === "paymentDate" || field === "shippedOn") {
      const date = dateIn(value, today);
      if (date) result.fields[field] = date; else result.warnings.push(`「${label}」日期无效、缺少年份或晚于今天，请手动补填。`);
    } else {
      const amount = amountIn(value);
      if (!amount) { if (field) result.errors.push(`「${label}」金额不明确，请核对。`); else result.unknownLines.push(line); continue; }
      // 元/人民币 are sufficient for CNY; a bare number is not a currency declaration.
      const currency = amount.currency || (/元/.test(value) ? "CNY" : "");
      if (field === "paidAmount") {
        result.fields.paidAmount = amount.amount;
        result.fields.paidCurrency = currency;
        if (!currency) result.warnings.push("实收币种未写明，请手动选择；不根据付款账户猜测币种。");
      } else if (currency !== "CNY") {
        result.warnings.push(`「${label}」未确认为人民币金额，未自动填入；不按市场汇率生成应收或成本。`);
        result.unknownLines.push(line);
      } else if (field === "chargeCny") result.fields.chargeCny = amount.amount;
      else if (field === "statedCost") result.statedCost = amount.amount;
      else {
        const category = categoryFor(key);
        result.expenses.push({ label, category, amountCny: amount.amount, counterparty: "" });
        if (!category) result.warnings.push(`「${label}」的费用类别待确认；商品名称不能确定属于配货、雕刻还是其他成本。`);
      }
    }
  }
  const parsed = parseOrderText(metadata.join("\n"), today);
  for (const key of ["orderRef", "customerCode", "personaName", "personaCode", "liveRoomCode", "hostName", "operatorName", "note"] as const) {
    const value = parsed.fields[key as keyof OrderTextFields];
    if (value) result.fields[key] = value;
  }
  result.errors.push(...parsed.errors);
  result.warnings.push(...parsed.warnings.filter(w => !/开单日期|商品明细/.test(w)));
  const { cost } = afterSaleTotals(result.fields, result.expenses);
  if (result.statedCost !== null && (cost === null || cost !== cents(result.statedCost))) result.errors.push("费用逐项合计与日报合计不一致，请核对；不能把合计当作另一笔费用重复录入。");
  if (!result.fields.chargeLabel) result.warnings.push("客户收费名称待确认（如设计雕刻费）；不根据成本名称自动决定收费名称。");
  if (!result.fields.businessDate) result.warnings.push("费用发生日期未提供，请补填；付款日、发货日不代替费用发生日。");
  if (result.expenses.length > 50) result.errors.push("费用超过50项，请拆分业务。");
  return result;
}
