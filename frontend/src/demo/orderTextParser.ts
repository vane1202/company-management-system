import type { Currency } from "../api";
import { cents, defaultBuyingFee, money } from "../commerceUi";

export type OrderTextFields = Partial<Record<"businessDate" | "orderRef" | "personaName" | "personaCode" | "liveRoomCode" | "hostName" | "customerCode" | "operatorName" | "customerLabel" | "source" | "note" | "customerDue" | "materialCostCny" | "materialLotNo", string>> & { customerCurrency?: Currency };
export type TextOrderItem = { kind: string; label: string; materialRef: string; priceCny: string; buyingFeeCny: string; feeManual: boolean };
export type TextPaymentDraft = { paymentDate: string; amount: string; currency: Currency | ""; channel: string; purpose: "deposit" | "balance" | "full"; remaining: string; remainingCurrency: Currency | "" };
export type ParsedOrderText = { fields: OrderTextFields; fieldHints: Partial<Record<keyof OrderTextFields, string>>; items: TextOrderItem[]; payment: TextPaymentDraft | null; itemTotal: string | null; statedTotal: string | null; derivedDue: boolean; warnings: string[]; errors: string[]; unknownLines: string[] };
export const importFieldLabels: Record<keyof OrderTextFields, string> = { businessDate: "开单卡日期", orderRef: "订单编号", personaName: "人设 / 主页", personaCode: "人设ID", liveRoomCode: "直播间编号", hostName: "对应主播", customerCode: "客户ID", operatorName: "经办客服姓名", customerLabel: "客户称呼", source: "来源 / 直播间", note: "备注", customerCurrency: "约定付款币种", customerDue: "约定总应收", materialCostCny: "料子本钱", materialLotNo: "料号" };
const aliases: Record<string, keyof OrderTextFields> = {
  "日期": "businessDate", "开单日期": "businessDate", "开单卡日期": "businessDate", "成交日期": "businessDate",
  "订单编号": "orderRef", "订单号": "orderRef", "开单编号": "orderRef",
  "人设": "personaName", "主页": "personaName", "人设/主页": "personaName", "人设ID": "personaCode", "人设编号": "personaCode",
  "客服": "operatorName", "经办客服": "operatorName", "经办客服姓名": "operatorName",
  "客户": "customerCode", "客户名": "customerLabel", "客户称呼": "customerLabel", "客户姓名": "customerLabel", "客户ID": "customerCode", "客户编号": "customerCode",
  "直播间编号": "liveRoomCode", "直播间ID": "liveRoomCode", "主播": "hostName", "对应主播": "hostName",
  "来源": "source", "来源/直播间": "source", "直播间": "source", "备注": "note",
  "料子本钱": "materialCostCny", "整单本钱": "materialCostCny", "料号": "materialLotNo"
};
const currencyPatterns: [Currency, RegExp][] = [["CNY", /人民币|人民幣|RMB|CNY|[¥￥]/i], ["TWD", /新台币|新臺幣|台币|臺幣|TWD|NTD|NT\s*\$/i], ["USD", /美元|美金|USD|US\s*\$/i]];
const numberPattern = "(?:\\d{1,3}(?:[,，]\\d{3})+|\\d+)(?:\\.\\d{1,2})?";
function currenciesIn(text: string): Currency[] { return currencyPatterns.filter(([, regex]) => regex.test(text)).map(([currency]) => currency); }
export function amountIn(text: string): { amount: string; currency: Currency | "" } | null {
  const currencies = currenciesIn(text);
  if (currencies.length > 1 || /[-−]\s*\d|\d\s*[万萬亿億]|\d\.\d{3,}/.test(text)) return null;
  const matches = text.match(new RegExp(numberPattern, "g"));
  if (!matches || matches.length !== 1) return null;
  const rest = text.replace(new RegExp(numberPattern), "").replace(/人民币|人民幣|新台币|新臺幣|台币|臺幣|美元|美金|RMB|CNY|TWD|NTD|USD|NT\s*\$|US\s*\$|[¥￥元\s]/gi, "");
  if (rest) return null;
  const value = cents(matches[0].replace(/[,，]/g, ""));
  return value === null ? null : { amount: money(value), currency: currencies[0] ?? "" };
}
export function dateIn(value: string, today: string): string | null {
  const match = /^(\d{2}|\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?$/.exec(value.trim());
  if (!match) return null;
  const year = match[1].length === 2 ? "20" + match[1] : match[1];
  const date = `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date && date <= today ? date : null;
}

/** Deterministic local parsing. Text is data, never code or instructions, and is never sent over a network. */
export function parseOrderText(text: string, today: string, options: { channel?: "live" | "private" } = {}): ParsedOrderText {
  const privateDeal = options.channel === "private";
  const result: ParsedOrderText = { fields: {}, fieldHints: {}, items: [], payment: null, itemTotal: null, statedTotal: null, derivedDue: false, warnings: [], errors: [], unknownLines: [] };
  if (!text.trim()) { result.errors.push("请先粘贴开单汇报文字。"); return result; }
  if (text.length > 12000) { result.errors.push("文字超过12000字，请按单个客户的一笔订单分别识别。"); return result; }
  const raw = new Map<string, string>();
  const ambiguous = new Set<string>();
  const rawItems: { label: string; value: string }[] = [];
  const setRaw = (key: string, value: string) => {
    if (ambiguous.has(key)) return;
    if (raw.has(key) && raw.get(key) !== value) { raw.delete(key); ambiguous.add(key); const message = `${importFieldLabels[key as keyof OrderTextFields] ?? key}出现多个不同值，未自动填入，请手动核对。`; if (["customerLabel", "customerCode", "orderRef", "businessDate", "实际收款", "未收尾款", "合计金额", "约定总应收", "付款币种"].includes(key)) result.errors.push(message + "请按单个客户的一笔订单分别识别。"); else result.warnings.push(message); }
    else raw.set(key, value);
  };
  for (const source of text.split(/\r?\n|\r/)) {
    const line = source.normalize("NFKC").replace(/\\\s*$/, "").trim();
    if (!line) continue;
    const match = /^([^:：]{1,40})[:：]\s*(.*)$/.exec(line);
    if (!match) { result.unknownLines.push(line); continue; }
    const key = match[1].replace(/\s/g, "").replace(/id$/i, "ID"), value = match[2].trim();
    if (!value) continue;
    if (/^(?:第[一二三四五六七八九十百\d]+(?:块|件)?(?:料子|原石|成品|商品)|(?:料子|原石|成品|商品)\d+)$/.test(key)) { rawItems.push({ label: match[1].trim(), value }); continue; }
    const field = aliases[key];
    const special: Record<string, string> = { "合计金额": "合计金额", "成交总额": "合计金额", "合计": "合计金额", "实际收款": "实际收款", "实收": "实际收款", "已收": "实际收款", "付款方式": "付款方式", "收款账户": "付款方式", "付款日期": "付款日期", "收款日期": "付款日期", "未收尾款": "未收尾款", "尾款": "未收尾款", "剩余尾款": "未收尾款", "约定总应收": "约定总应收", "总应收": "约定总应收", "付款币种": "付款币种", "约定付款币种": "付款币种" };
    if (field) setRaw(field, value);
    else if (special[key]) setRaw(special[key], value);
    else result.unknownLines.push(line);
  }
  for (const [key, value] of raw) {
    if (!(key in importFieldLabels) || key === "customerCurrency" || key === "customerDue") continue;
    if (key === "businessDate") {
      const date = dateIn(value, today);
      if (date) result.fields.businessDate = date;
      else result.warnings.push("开单日期缺少年份、日期无效或晚于今天，请手动填写。");
    } else if (key === "materialCostCny") {
      const amount = amountIn(value);
      if (amount && (!amount.currency || amount.currency === "CNY")) result.fields.materialCostCny = amount.amount;
      else result.warnings.push("料子本钱无法确认为人民币金额，未自动填入。");
    } else {
      const max = key === "note" ? 500 : ["orderRef", "customerLabel", "materialLotNo"].includes(key) ? 64 : 128;
      if (value.length > max) result.warnings.push(`${importFieldLabels[key as keyof OrderTextFields]}超出${max}字，未截断，请手动精简后填写。`);
      else Object.assign(result.fields, { [key]: value });
    }
  }
  // Company report convention: "客户" is the social/customer identifier, not a separate legal name.
  if (result.fields.customerCode && !raw.has("customerLabel") && !ambiguous.has("customerLabel")) {
    if (result.fields.customerCode.length <= 64) {
      result.fields.customerLabel = result.fields.customerCode;
      result.fieldHints.customerLabel = "未另写称呼，沿用客户ID作为显示名称，可修改。";
    } else result.warnings.push("客户ID已识别，但超过客户称呼长度，请另填显示名称。");
  }
  // Only the agreed short form "某某直播间" is an attribution, never a persona-to-room lookup.
  const roomRemark = result.fields.note?.trim();
  const hostMatch = roomRemark && /^([\p{Script=Han}A-Za-z0-9·•_\- ]{1,64})直播[间間]$/u.exec(roomRemark);
  const noteHost = hostMatch?.[1].trim();
  if (!privateDeal && noteHost && !/(?:来自|转自|客户|不是|并非|疑似|可能|待确认|或者|以及)/.test(noteHost)) {
    if (raw.has("hostName") || ambiguous.has("hostName")) {
      if (result.fields.hostName && result.fields.hostName !== noteHost) result.warnings.push(`备注中的主播「${noteHost}」与明确填写的主播「${result.fields.hostName}」不同，保留明确字段，请核对。`);
    } else {
      result.fields.hostName = noteHost;
      result.fieldHints.hostName = `从备注「${roomRemark}」提取；原备注保留。`;
    }
  }
  const seenLabels = new Set<string>();
  for (const row of rawItems) {
    if (seenLabels.has(row.label)) { result.errors.push(`商品序号重复：${row.label}，请拆开核对。`); continue; }
    seenLabels.add(row.label);
    const parts = row.value.split(/[+＋]/);
    const price = amountIn(parts[0]), explicitFee = parts.length === 2 ? amountIn(parts[1]) : null;
    const kind = row.label.includes("成品") ? "finished" : "material";
    if (privateDeal) {
      if (parts.length !== 1 || !price || (price.currency && price.currency !== "CNY")) {
        result.errors.push(`${row.label}请只写人民币料价。私推不收代购费，不要写成「料价+代购费」。`); continue;
      }
      result.items.push({ kind, label: row.label, materialRef: "", priceCny: price.amount, buyingFeeCny: "0.00", feeManual: false });
      continue;
    }
    if (parts.length > 2 || !price || price.currency && price.currency !== "CNY" || parts.length === 2 && (!explicitFee || explicitFee.currency && explicitFee.currency !== "CNY")) {
      result.errors.push(`${row.label}金额无法识别，请使用「料价+代购费」，金额为人民币。`); continue;
    }
    const automatic = defaultBuyingFee(price.amount, kind)!;
    const fee = explicitFee?.amount ?? automatic;
    if (kind === "finished" && fee !== "0.00") { result.errors.push(`${row.label}为成品但填写了服务费，请核对商品类别。`); continue; }
    if (fee !== automatic) result.warnings.push(`${row.label}代购费为${fee}元，与料价的10%（${automatic}元）不同，将保留文字金额，请核对。`);
    if (parts.length === 1 && kind === "material") result.warnings.push(`${row.label}未写代购费，按料价10%计算为${automatic}元，请核对。`);
    result.items.push({ kind, label: row.label, materialRef: "", priceCny: price.amount, buyingFeeCny: fee, feeManual: fee !== automatic });
  }
  if (result.items.length > 50) result.errors.push("单笔订单最多50件商品，请拆分订单。");
  if (result.items.length) result.itemTotal = money(result.items.reduce((sum, item) => sum + cents(item.priceCny)! + cents(item.buyingFeeCny)!, 0n));
  if (raw.has("合计金额")) {
    const amount = amountIn(raw.get("合计金额")!);
    if (amount && (!amount.currency || amount.currency === "CNY")) result.statedTotal = amount.amount;
    else result.warnings.push("合计金额无法确认为人民币金额，未与商品明细混合计算。");
    if (result.itemTotal && result.statedTotal && result.itemTotal !== result.statedTotal) result.errors.push(`商品合计${result.itemTotal}元，与汇报合计${result.statedTotal}元不一致，请更正文字后重新识别。`);
  }
  if (raw.has("实际收款") || raw.has("付款日期") || raw.has("付款方式") || raw.has("未收尾款")) {
    const original = raw.get("实际收款") ?? "";
    const pending = /(?:未收(?:尾款)?|未付(?:尾款)?|尚欠(?:尾款)?|待收(?:尾款)?|剩余(?:尾款)?)\s*[:：]?\s*(.*)/.exec(original);
    const paidText = original.slice(0, pending?.index ?? original.length);
    const paid = amountIn(paidText.replace(/[（(][^）)]*[）)]/g, "").replace(/定金|订金|訂金|尾款|全款/g, "").trim());
    const remainingText = pending?.[1] ?? raw.get("未收尾款");
    const remaining = remainingText ? amountIn(remainingText) : null;
    const date = raw.has("付款日期") ? dateIn(raw.get("付款日期")!, today) : "";
    result.payment = { paymentDate: date ?? "", amount: paid?.amount ?? "", currency: paid?.currency ?? "", channel: raw.get("付款方式") ?? "", purpose: /定金|订金|訂金/.test(paidText) ? "deposit" : /尾款/.test(paidText) ? "balance" : "full", remaining: remaining?.amount ?? "", remainingCurrency: remaining?.currency ?? "" };
    if (!/定金|订金|訂金|尾款|全款/.test(paidText)) result.warnings.push("付款性质未写明，收款草稿暂列全款，请核对。");
    if (!paid || !paid.currency) result.warnings.push("实际收款金额或币种不明确，请补全收款草稿，不根据账户名称猜币种。");
    if (!date) result.warnings.push("付款日期未写明或无效，收款草稿留空，请手动核对。");
    if (date && result.fields.businessDate && date < result.fields.businessDate) result.warnings.push("付款日期早于开单日期，请核对两个日期。");
    if (remainingText && !remaining) result.warnings.push("尾款金额无法识别，未推算约定总应收。");
    if (remainingText && pending && raw.has("未收尾款")) {
      const other = amountIn(raw.get("未收尾款")!);
      if (!other || !remaining || other.amount !== remaining.amount || other.currency !== remaining.currency) result.errors.push("实收行与单独尾款行不一致，请核对后重新识别。");
    }
  }
  const explicitCurrency = currenciesIn(raw.get("付款币种") ?? "");
  const explicitDue = raw.has("约定总应收") ? amountIn(raw.get("约定总应收")!) : null;
  if (explicitCurrency.length > 1) result.warnings.push("约定付款币种存在多个值，未自动确定。");
  if (explicitCurrency.length === 1) result.fields.customerCurrency = explicitCurrency[0];
  if (explicitCurrency.length === 1 && explicitDue?.currency && explicitCurrency[0] !== explicitDue.currency) result.errors.push("约定付款币种与总应收币种不同，请核对后重新识别。");
  if (explicitDue?.currency) result.fields.customerCurrency = explicitDue.currency;
  const payment = result.payment;
  if (!result.fields.customerCurrency && payment?.currency) result.fields.customerCurrency = payment.currency;
  if (explicitDue && result.fields.customerCurrency) result.fields.customerDue = explicitDue.amount;
  else if (raw.has("约定总应收")) result.warnings.push("约定总应收金额或币种不明确，未自动填入。");
  if (!raw.has("约定总应收") && !ambiguous.has("约定总应收") && explicitCurrency.length < 2 && payment?.amount && payment.currency && payment.remaining && payment.remainingCurrency === payment.currency && (!result.fields.customerCurrency || result.fields.customerCurrency === payment.currency)) {
    result.fields.customerCurrency = payment.currency;
    result.fields.customerDue = money(cents(payment.amount)! + cents(payment.remaining)!);
    result.derivedDue = true;
    result.warnings.push(`约定总应收${result.fields.customerDue} ${payment.currency}由「已收+未收尾款」推算，请确认这是客户约定金额。未使用市场汇率计算欠款。`);
  }
  if (payment?.remaining && payment.currency !== payment.remainingCurrency) result.warnings.push("已收与尾款币种不同或缺失，不相加、不推算约定总应收。");
  if (explicitDue && payment?.amount && payment.currency === result.fields.customerCurrency && payment.remaining && payment.remainingCurrency === payment.currency && cents(explicitDue.amount) !== cents(payment.amount)! + cents(payment.remaining)!) result.errors.push("约定总应收不等于已收与尾款之和，请核对。");
  if (result.fields.customerCurrency === "CNY" && result.fields.customerDue && result.itemTotal && result.fields.customerDue !== result.itemTotal) result.errors.push("人民币约定总应收与商品明细合计不同，请核对是否混入了其他订单或追加收费。");
  if (!result.fields.businessDate) result.warnings.push("开单日期待补全。");
  if (!result.items.length) result.warnings.push(privateDeal ? "未识别出商品明细；请逐件填写料价，私推不写代购费。" : "未识别出商品明细；只填写合计金额不能代替逐件料价和代购费。");
  if (!result.fields.customerCode) result.warnings.push("客户ID未提供，请补填；单独填写的客户称呼不代替客户ID。");
  if (privateDeal) {
    if (result.fields.hostName || result.fields.liveRoomCode || (result.fields.source && /直播/.test(result.fields.source))) result.errors.push("私推成交不能填写主播或直播间。请改用直播间开单，或删去直播间信息后重新识别。");
    if (result.fields.note && /直播间|直播間/.test(result.fields.note)) result.errors.push("备注里写了直播间。私推不归入直播间；如果这是直播间开单，请切换成交渠道。");
  } else {
    if (!result.fields.personaCode || !result.fields.liveRoomCode) result.warnings.push("人设ID、直播间编号需明确提供，不根据人设或主播名称猜测关联。");
    if (!result.fields.hostName) result.warnings.push("主播未明确填写，备注也不符合「某某直播间」格式，请补填主播。");
    if (!result.fields.orderRef) result.warnings.push("订单编号未提供，请补填。");
  }
  if (result.unknownLines.length) result.warnings.push(`另有${result.unknownLines.length}行未识别，请查看并手动补充。`);
  return result;
}
