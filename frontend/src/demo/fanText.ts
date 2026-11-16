import { fanFields } from "../dailyDetail";
import { dateIn } from "./orderTextParser";
import { contactFromNote, reasonGap, type InvalidReason } from "./assessmentFoundation";
export type FanLeadDraft = { customer: string; channel: "ms" | "ws"; summary: string; qualified: boolean; contact: "" | "replied" | "read_no_reply" | "unread" | "invalid"; invalidReason: "" | InvalidReason; invalidNote: string; roster: "intake" | "reviewOnly" };
export type FanReasonCounts = { invalidNoChinese: string; invalidMisclick: string; invalidObscene: string; qualifiedToday: string };
export type FanFillFields = { businessDate: string; operatorName: string; pageName: string; adAccountId: string; note: string } & Record<keyof typeof fanFields, string> & FanReasonCounts;
export function emptyFanFields(): FanFillFields { return { businessDate: "", operatorName: "", pageName: "", adAccountId: "", note: "", invalidNoChinese: "", invalidMisclick: "", invalidObscene: "", qualifiedToday: "", ...Object.fromEntries(Object.keys(fanFields).map(k => [k, ""])) } as FanFillFields; }
export type FanText = { fields: Partial<FanFillFields>; leads: FanLeadDraft[]; errors: string[]; warnings: string[]; unknownLines: string[] };
const aliases: Record<string, keyof FanFillFields> = {
  "日期": "businessDate", "业务日期": "businessDate", "客服": "operatorName", "经办客服": "operatorName", "下粉广告户ID": "adAccountId", "下粉广告户": "adAccountId", "广告户ID": "adAccountId", "广告账户ID": "adAccountId", "主页(全名)": "pageName", "主页": "pageName", "人设": "pageName", "人设ID": "pageName", "人设编号": "pageName", "备注": "note",
  "本月Ms进粉总数": "msMonth", "本月Ms进粉人数": "msMonth", "本月Ws进粉人数": "wsMonth", "本月Ws进粉总数": "wsMonth", "今日Ms进粉总数": "msToday", "今日Ms进粉人数": "msToday", "今日Ws进粉人数": "wsToday", "今日Ws进粉总数": "wsToday",
  "今日有效": "validToday", "正常沟通回复": "commReplied", "取得沟通": "commReplied", "已读不回": "commReadNoReply", "未读": "commUnread", "无效粉": "commInvalid", "无效客源": "commInvalid",
  ...Object.fromEntries(Object.entries(fanFields).map(([key, label]) => [label.replace(/\s/g, ""), key])),
  "不会中文": "invalidNoChinese", "非中文客户": "invalidNoChinese", "误点咨询": "invalidMisclick", "错按咨询": "invalidMisclick", "淫秽色情": "invalidObscene", "色情咨询": "invalidObscene", "淫秽、色情类": "invalidObscene", "明确需求": "qualifiedToday", "已明确需求": "qualifiedToday"
};
export const fanFillLabels: Record<keyof FanFillFields, string> = { businessDate: "业务日期", operatorName: "经办客服姓名", pageName: "人设 / 主页", adAccountId: "下粉广告户ID", note: "备注", invalidNoChinese: "非中文客户", invalidMisclick: "误点咨询", invalidObscene: "淫秽、色情类", qualifiedToday: "明确需求人数", ...fanFields };
export function parseFanText(text: string, today: string): FanText {
  const result: FanText = { fields: {}, leads: [], errors: [], warnings: [], unknownLines: [] };
  if (!text.trim() || text.length > 12000) { result.errors.push("请粘贴一个接待账号、一张主页的日报，最多12000字。"); return result; }
  const seen = new Set<string>();
  let channel: "ms" | "ws" | null = null;
  let invalidApply = false;
  let assumedChannel = false;
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.normalize("NFKC").replace(/\\\s*$/, "").trim();
    if (!line) continue;
    if (/^今日申请无效[:：]?\s*$/.test(line)) { invalidApply = true; continue; }
    const pair = /^([^:：]{1,40})[:：]\s*(.*)$/.exec(line);
    const normalized = pair?.[1].replace(/\s/g, "").replace(/messenger|message/gi, "Ms").replace(/whatsapp/gi, "Ws").replace(/ms/gi, "Ms").replace(/ws/gi, "Ws").replace(/id$/i, "ID");
    const key = normalized ? aliases[normalized] : undefined;
    if (key && pair) {
      invalidApply = false;
      const value = pair[2].trim();
      if (seen.has(key)) {
        if (key === "pageName" && result.fields.pageName === value) continue;
        result.errors.push(key === "pageName" ? "人设／主页重复且内容不同。人设ID与人设／主页是同一项，请只保留一个。" : `「${fanFillLabels[key]}」重复出现，请拆分日报或核对后重新识别。`);
        continue;
      }
      seen.add(key);
      if (key === "msToday" || key === "wsToday") channel = key === "msToday" ? "ms" : "ws";
      const countField = key === "invalidNoChinese" || key === "invalidMisclick" || key === "invalidObscene" || key === "qualifiedToday";
      if (key in fanFields || countField) {
        if (!/^\d{1,7}(?:人|个)?$/.test(value)) result.errors.push(`「${fanFillLabels[key]}」须为非负整数。`);
        else result.fields[key] = String(Number(value.replace(/[人个]$/, "")));
      } else if (key === "businessDate") {
        const date = dateIn(value, today);
        if (date) result.fields.businessDate = date;
        else result.warnings.push("业务日期缺少年份、无效或晚于今天，请手动补填，未默认归入今天。");
      } else if (key === "operatorName" || key === "adAccountId") {
        if (key === "adAccountId") rememberAdAccount(result, value);
        else {
          const split = splitOperator(value);
          if (!split.name || split.name.length > 128) result.errors.push("「经办客服姓名」过长或为空，请精简。");
          else result.fields.operatorName = split.name;
          if (split.adAccountId) rememberAdAccount(result, split.adAccountId);
        }
      } else if (value.length > (key === "note" ? 1000 : 128)) result.errors.push(`「${fanFillLabels[key]}」过长，请精简。`);
      else result.fields[key] = value;
      continue;
    }
    const numbered = /^\d+[.、)\s]+\s*(.+)$/.exec(line)?.[1];
    if (invalidApply) {
      if (!numbered) { result.unknownLines.push(line); continue; }
      const extracted = extractChannel(numbered);
      const found = findInvalidReason(extracted.text);
      if (!found) { result.errors.push("「" + extracted.text.slice(0, 40) + "」缺少无效原因。请写称呼、预设原因，再写一句情况。"); continue; }
      const customer = extracted.text.slice(0, found.index).trim();
      const note = extracted.text.slice(found.index + found.length).trim();
      if (!customer || customer.length > 128) { result.errors.push("今日申请无效的客户称呼为空或过长。"); continue; }
      if (note.length > 1000) { result.errors.push("「" + customer + "」的情况说明过长。"); continue; }
      if (found.reason === "custom" && !note) { result.errors.push("「" + customer + "」选择了自定义，需要填写具体原因。"); continue; }
      if (!extracted.channel) assumedChannel = true;
      result.leads.push({ customer, channel: extracted.channel || "ms", summary: note, qualified: false, contact: "invalid", invalidReason: found.reason, invalidNote: note, roster: "reviewOnly" });
      continue;
    }
    const lead = numbered ? (/^(.+?)\s+([\p{Script=Han}\d].*)$/u.exec(numbered) || /^(.+?)\s{2,}(.+)$/.exec(numbered)) : null;
    if (lead && channel) {
      const summary = lead[2].trim(); const noted = contactFromNote(summary);
      result.leads.push({ customer: lead[1].trim(), channel, summary, qualified: false, contact: noted.contact, invalidReason: noted.invalidReason, invalidNote: noted.contact === "invalid" ? summary : "", roster: "intake" });
    } else result.unknownLines.push(line);
  }
  const ids = new Set<string>();
  for (const row of result.leads) { const id = `${row.channel}:${row.customer.toLowerCase()}`; if (ids.has(id)) result.errors.push(`客户「${row.customer}」在同一渠道重复，请核对。`); ids.add(id); }
  if (result.leads.length > 100) result.errors.push("客户明细超过100条，请拆分日报。");
  if (result.leads.length) result.warnings.push("客户姓名与描述已拆分为待核对明细；姓名含空格时请核对分界。是否明确需求均留待客服确认，不自动判定初步转化成功。");
  for (const [key, ch] of [["msToday", "ms"], ["wsToday", "ws"]] as const) {
    if (result.fields[key] !== undefined && result.leads.filter(l => l.channel === ch).length !== Number(result.fields[key])) result.warnings.push(`${ch === "ms" ? "Messenger" : "WhatsApp"}客户明细条数与今日进粉数不同，请补充或核对。`);
  }
  if (result.fields.qualifiedToday !== undefined) result.warnings.push("明确需求人数只作对照，需在客户明细逐条确认后才计入开口转化率。");
  if (assumedChannel) result.warnings.push("今日申请无效中有客户未写 Messenger 或 WhatsApp，已暂记为 Messenger，可在明细里修改。");
  const namedInvalid = result.leads.filter((lead) => lead.contact === "invalid").length;
  if (/^\d+$/.test(result.fields.commInvalid || "")) {
    const invalidTotal = Number(result.fields.commInvalid);
    if (invalidTotal > namedInvalid) result.warnings.push("日报无效粉 " + invalidTotal + " 人，本次只有 " + namedInvalid + " 人建档送复核。其余 " + (invalidTotal - namedInvalid) + " 人只计入当日人数，主管无法逐个复核。");
    else if (namedInvalid > invalidTotal) result.warnings.push("点名申请无效 " + namedInvalid + " 人，多于日报无效粉 " + invalidTotal + " 人，请核对人数。");
  }
  const gap = reasonGap(result.fields.commInvalid || "", [result.fields.invalidNoChinese || "", result.fields.invalidMisclick || "", result.fields.invalidObscene || ""]);
  if (gap.status === "over") result.warnings.push("三类无效原因的人数合计超过无效粉人数。人数只作对照，不生成没有称呼的复核。");
  if (!result.fields.adAccountId) {
    result.fields.adAccountId = "";
    result.warnings.push("未识别下粉广告户ID。登记后显示“来源待补”，不会按客服姓名或主页猜测。");
  }
  result.warnings.push("本月进粉仅保留累计快照；沟通情况按当日汇报，不要求与今日进粉合计相等。");
  return result;
}

function splitOperator(value: string): { name: string; adAccountId: string } {
  const matched = /^(.*)\((\d{1,32})\)$/.exec(value.trim());
  if (!matched || !matched[1].trim()) return { name: value.trim(), adAccountId: "" };
  return { name: matched[1].trim(), adAccountId: matched[2] };
}
function rememberAdAccount(result: FanText, value: string) {
  if (!/^\d{1,32}$/.test(value)) {
    result.errors.push("「下粉广告户ID」只保留数字文本，前导零按原文保留。");
    return;
  }
  if (result.fields.adAccountId && result.fields.adAccountId !== value) {
    result.errors.push("下粉广告户ID出现不同的值，请按广告户拆成两份日报分别登记。");
    return;
  }
  result.fields.adAccountId = value;
}

const invalidReasonPhrases: Array<[string, InvalidReason]> = [["淫秽、色情类", "obscene"], ["淫秽色情类", "obscene"], ["淫秽、色情", "obscene"], ["淫秽色情", "obscene"], ["色情咨询", "obscene"], ["非中文客户", "no_chinese"], ["不会中文", "no_chinese"], ["不懂中文", "no_chinese"], ["误点咨询", "misclick"], ["错按咨询", "misclick"], ["自定义", "custom"], ["色情", "obscene"], ["淫秽", "obscene"], ["误点", "misclick"], ["错按", "misclick"], ["按错", "misclick"]];
function findInvalidReason(text: string): { index: number; length: number; reason: InvalidReason } | null {
  let found: { index: number; length: number; reason: InvalidReason } | null = null;
  for (const [phrase, reason] of invalidReasonPhrases) {
    const index = text.indexOf(phrase);
    if (index <= 0) continue;
    if (!found || index < found.index || (index === found.index && phrase.length > found.length)) found = { index, length: phrase.length, reason };
  }
  return found;
}
function extractChannel(text: string): { channel: "ms" | "ws" | null; text: string } {
  const match = /(^|\s)(Messenger|WhatsApp|Ms|Ws)(?=\s|$)/i.exec(text);
  if (!match) return { channel: null, text };
  const word = match[2].toLowerCase();
  const channel = word === "whatsapp" || word === "ws" ? "ws" : "ms";
  return { channel, text: (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).replace(/\s+/g, " ").trim() };
}
